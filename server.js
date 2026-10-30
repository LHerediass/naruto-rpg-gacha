const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// BANCO DE DADOS LOCAL OU MONGO ATLAS (Substitua se tiver string do Atlas)
const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/narutorpg';

mongoose.connect(mongoURI)
    .then(() => console.log('✅ Conectado ao Banco de Dados do Jogo Ninja'))
    .catch(err => console.error('❌ Erro no Banco de Dados:', err));

// Schema do Usuário (Nenhum dado é perdido)
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    gems: { type: Number, default: 500 },
    pvpPoints: { type: Number, default: 0 },
    pvpStreak: { type: Number, default: 0 },
    currentEpisode: { type: Number, default: 1 },
    inventory: { type: Object, default: {} },
    equipmentInventory: { type: Object, default: {} },
    team: { type: Array, default: [] }
});

const UserModel = mongoose.model('User', UserSchema);

// ROTAS HTTP (API)
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const exists = await UserModel.findOne({ username });
        if (exists) return res.status(400).json({ success: false, message: "Nome de usuário já em uso." });

        const newUser = new UserModel({ username, password });
        await newUser.save();
        res.json({ success: true, message: "Conta registrada com sucesso!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro no servidor ao criar conta." });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await UserModel.findOne({ username, password });
        if (!user) return res.status(400).json({ success: false, message: "Usuário ou senha incorretos." });

        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro no servidor ao realizar login." });
    }
});

app.post('/api/save', async (req, res) => {
    try {
        const { username, data } = req.body;
        await UserModel.findOneAndUpdate({ username }, data);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao salvar progresso." });
    }
});

app.get('/api/ranking', async (req, res) => {
    try {
        const top10 = await UserModel.find({}, 'username pvpPoints pvpStreak')
            .sort({ pvpPoints: -1, pvpStreak: -1 })
            .limit(10);
        res.json(top10);
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao buscar ranking." });
    }
});

// GERENCIAMENTO DE FILA PVP E WEBSOCKETS
let pvpQueue = [];

io.on('connection', (socket) => {
    console.log('⚡ Jogador Conectado:', socket.id);

    socket.on('buscar_pvp', (userData) => {
        socket.userData = userData;
        pvpQueue.push(socket);

        // Busca oponente do mesmo Elo na fila
        let oponenteIdx = pvpQueue.findIndex(s => s.userData.elo === userData.elo && s.id !== socket.id);

        if (oponenteIdx !== -1) {
            let oponenteSocket = pvpQueue.splice(oponenteIdx, 1)[0];
            let meuSocket = pvpQueue.splice(pvpQueue.indexOf(socket), 1)[0];

            meuSocket.emit('partida_encontrada', { rival: oponenteSocket.userData });
            oponenteSocket.emit('partida_encontrada', { rival: meuSocket.userData });
        }
    });

    socket.on('cancelar_pvp', () => {
        pvpQueue = pvpQueue.filter(s => s.id !== socket.id);
    });

    socket.on('disconnect', () => {
        pvpQueue = pvpQueue.filter(s => s.id !== socket.id);
        console.log('❌ Jogador Desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor Ninja rodando na porta ${PORT}`));