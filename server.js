const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// تخزين بيانات الغرف
const rooms = {};

// إنشاء كود غرفة عشوائي
function generateRoomCode() {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// تقديم الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// جميع الطلبات الأخرى تذهب إلى ملف HTML الرئيسي
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// معالجة اتصالات السوكيت
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // الانضمام إلى غرفة
    socket.on('createPrivateRoom', (data) => {
        const roomCode = generateRoomCode();
        const roomId = socket.id; // استخدام ID السوكيت كمعرف فريد للغرفة
        
        rooms[roomId] = {
            id: roomId,
            code: roomCode,
            name: data.roomName,
            isPrivate: true,
            maxPlayers: data.maxPlayers,
            totalRounds: data.totalRounds,
            players: [{
                id: socket.id,
                name: data.playerName,
                score: 0,
                isHost: true,
                isDrawing: false
            }],
            gameStarted: false,
            currentRound: 0,
            currentWord: '',
            currentArtist: null
        };
        
        socket.join(roomId);
        socket.emit('privateRoomCreated', {
            roomId,
            roomCode,
            roomName: data.roomName,
            players: rooms[roomId].players
        });
        
        console.log(`Private room created: ${roomId} (${roomCode})`);
    });

    // الانضمام إلى غرفة خاصة
    socket.on('joinPrivateRoom', (data) => {
        const room = Object.values(rooms).find(r => r.code === data.roomCode);
        
        if (!room) {
            socket.emit('roomNotFound');
            return;
        }
        
        if (room.players.length >= room.maxPlayers) {
            socket.emit('roomFull');
            return;
        }
        
        room.players.push({
            id: socket.id,
            name: data.playerName,
            score: 0,
            isHost: false,
            isDrawing: false
        });
        
        socket.join(room.id);
        io.to(room.id).emit('playerJoinedWaitingRoom', room.players);
        socket.emit('joinedRoom', {
            roomId: room.id,
            roomName: room.name,
            isPrivate: true,
            maxPlayers: room.maxPlayers,
            totalRounds: room.totalRounds,
            roomCode: room.code,
            players: room.players
        });
    });

    // بدء اللعبة
    socket.on('startGame', (data) => {
        const room = rooms[data.roomId];
        if (room && room.players.length >= 2) {
            room.gameStarted = true;
            io.to(room.id).emit('gameStarted', {
                players: room.players,
                roomCode: room.code
            });
            
            // بدء الجولة الأولى
            startNewRound(room);
        }
    });

    // بدء جولة جديدة
    function startNewRound(room) {
        room.currentRound++;
        room.currentArtist = (room.currentArtist === null || room.currentArtist >= room.players.length - 1) ? 
            0 : room.currentArtist + 1;
        
        const words = ['بيت', 'قطة', 'شمس', 'قمر', 'سيارة', 'طائرة', 'وردة', 'شجرة'];
        room.currentWord = words[Math.floor(Math.random() * words.length)];
        
        // تحديث حالة اللاعبين
        room.players.forEach((player, index) => {
            player.isDrawing = index === room.currentArtist;
        });
        
        io.to(room.id).emit('newRoundStarted', {
            word: room.currentWord,
            artistIndex: room.currentArtist,
            timeLeft: 60,
            currentRound: room.currentRound
        });
    }

    // معالجة بيانات الرسم
    socket.on('draw', (data) => {
        socket.to(data.roomId).emit('drawingData', data);
    });

    // مسح اللوحة
    socket.on('clearCanvas', (data) => {
        socket.to(data.roomId).emit('canvasCleared');
    });

    // معالجة التخمينات
    socket.on('makeGuess', (data) => {
        const room = rooms[data.roomId];
        if (!room || !room.gameStarted) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.isDrawing) return;
        
        // إرسال التخمين للجميع
        io.to(room.id).emit('newMessage', {
            text: data.guess,
            type: 'guess',
            playerName: player.name
        });
        
        // التحقق من الإجابة الصحيحة
        if (data.guess.toLowerCase() === room.currentWord.toLowerCase()) {
            // إضافة النقاط
            player.score += 10;
            const artist = room.players[room.currentArtist];
            artist.score += 5;
            
            io.to(room.id).emit('newMessage', {
                text: `🎉 ${player.name} خمن بشكل صحيح! الكلمة كانت: ${room.currentWord}`,
                type: 'correct'
            });
            
            io.to(room.id).emit('correctGuess', {
                players: room.players
            });
            
            // إنهاء الجولة
            endRound(room, true);
        }
    });

    // إنهاء الجولة
    function endRound(room, wasGuessed) {
        room.gameStarted = false;
        
        const nextArtist = (room.currentArtist + 1) % room.players.length;
        const isGameOver = room.currentRound >= room.totalRounds && nextArtist === 0;
        
        io.to(room.id).emit('roundEnded', {
            players: room.players,
            nextArtistIndex: nextArtist,
            currentRound: room.currentRound,
            gameOver: isGameOver
        });
        
        if (isGameOver) {
            io.to(room.id).emit('gameOver', {
                players: room.players
            });
            delete rooms[room.id];
        }
    }

    // مغادرة اللاعب
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // البحث عن الغرفة التي كان اللاعب متصلاً بها
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                // إزالة اللاعب من الغرفة
                room.players.splice(playerIndex, 1);
                
                // إذا كان المضيف قد غادر، إنهاء اللعبة
                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else {
                    // إعلام اللاعبين الآخرين
                    if (room.gameStarted) {
                        // إنهاء اللعبة إذا كانت قيد التشغيل
                        io.to(roomId).emit('gameOver', {
                            players: room.players
                        });
                        delete rooms[roomId];
                    } else {
                        // في غرفة الانتظار
                        io.to(roomId).emit('playerLeftWaitingRoom', room.players);
                    }
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});