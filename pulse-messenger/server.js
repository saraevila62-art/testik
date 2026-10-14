const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SECRET = 'pulse_secret_key_2024';
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// "База данных" в памяти
const db = {
    users: [],
    chats: [],
    messages: []
};

// РЕГИСТРАЦИЯ (по email)
app.post('/api/register', async (req, res) => {
    const { email, password, username } = req.body;
    
    if (db.users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email уже зарегистрирован' });
    }
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Имя пользователя занято' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = { 
        id: Date.now().toString(), 
        email, 
        username, 
        password: hashed 
    };
    db.users.push(user);
    res.json({ message: 'Успешно' });
});

// ВХОД (по email)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = db.users.find(u => u.email === email);
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username }, 
        SECRET, 
        { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, username: user.username } });
});

// Socket.io авторизация
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try {
        socket.user = jwt.verify(token, SECRET);
        next();
    } catch (e) { 
        next(new Error('Ошибка авторизации')); 
    }
});

io.on('connection', (socket) => {
    console.log(`[Pulse] ${socket.user.username} подключился`);

    socket.on('get:users', () => {
        const users = db.users.map(u => ({ id: u.id, username: u.username, email: u.email }));
        socket.emit('users:list', users);
    });

    socket.on('get:chats', () => {
        const userChats = db.chats.filter(c => c.members.includes(socket.user.id));
        const chatsData = userChats.map(chat => {
            const companionId = chat.members.find(id => id !== socket.user.id);
            const companion = db.users.find(u => u.id === companionId);
            const lastMsg = db.messages.filter(m => m.chatId === chat.id).pop();
            return {
                id: chat.id,
                companion: companion ? companion.username : 'Unknown',
                companionId: companionId,
                lastMessage: lastMsg ? lastMsg.text : 'Нет сообщений',
                timestamp: lastMsg ? lastMsg.timestamp : 0
            };
        });
        chatsData.sort((a, b) => b.timestamp - a.timestamp);
        socket.emit('chats:list', chatsData);
    });

    socket.on('open:chat', (companionId) => {
        let chat = db.chats.find(c => 
            c.members.includes(socket.user.id) && c.members.includes(companionId)
        );
        
        if (!chat) {
            chat = { id: Date.now().toString(), members: [socket.user.id, companionId] };
            db.chats.push(chat);
        }

        const companion = db.users.find(u => u.id === companionId);
        const history = db.messages.filter(m => m.chatId === chat.id);
        
        socket.join(chat.id);
        socket.emit('chat:opened', { 
            chatId: chat.id, 
            companionName: companion.username,
            history 
        });
    });

    socket.on('send:message', ({ chatId, text }) => {
        const msg = {
            id: Date.now().toString(),
            chatId,
            senderId: socket.user.id,
            text,
            timestamp: Date.now()
        };
        db.messages.push(msg);
        io.to(chatId).emit('new:message', msg);
        io.emit('refresh:chats');
    });

    socket.on('disconnect', () => {
        console.log(`[Pulse] ${socket.user.username} отключился`);
    });
});

server.listen(PORT, () => console.log(`🚀 Pulse сервер работает на http://localhost:${PORT}`));