import { Server } from "socket.io";

export default async (req, res) => {
  if (!res.socket.server.io) {
    console.log("New Socket.io server...");
    const httpServer = res.socket.server;
    const io = new Server(httpServer, {
      path: "/api/socket",
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    // هنا تضيف منطق Socket.IO الخاص بك
    io.on("connection", (socket) => {
      console.log(`Client connected: ${socket.id}`);
      
      socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });
    
    res.socket.server.io = io;
  }
  res.end();
};
