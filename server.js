const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ==========================================
// CONEXÃO COM O MONGODB ATLAS
// ==========================================
// Substitua a string abaixo pela sua URI real do MongoDB se necessário
const MONGO_URI = process.env.MONGO_URI || "SUA_URI_DO_MONGODB_AQUI";

mongoose.connect(MONGO_URI)
    .then(() => console.log("Conectado ao MongoDB Atlas com sucesso!"))
    .catch((err) => console.error("Erro ao conectar ao MongoDB:", err));

// ==========================================
// MODELO DE USUÁRIO (Mongoose Schema)
// ==========================================
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    gems: { type: Number, default: 500 },
    pvpPoints: { type: Number, default: 0 },
    pvpStreak: { type: Number, default: 0 },
    inventory: { type: Object, default: {} },
    equipmentInventory: { type: Object, default: {} },
    team: { type: Array, default: [] },
    currentEpisode: { type: Number, default: 1 }
});

const User = mongoose.model('User', userSchema);

// ==========================================
// ROTAS DA API REST
// ==========================================

// Rota de Login (Lê do MongoDB)
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        
        if (!user) {
            return res.json({ success: false, message: "Usuário ou senha incorretos!" });
        }

        res.json({ success: true, user });
    } catch (err) {
        console.error("Erro no login:", err);
        res.status(500).json({ success: false, message: "Erro no servidor." });
    }
});

// Rota de Registro (Cria no MongoDB)
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existe = await User.findOne({ username });
        if (existe) {
            return res.json({ success: false, message: "Usuário já existe!" });
        }

        const novoUser = new User({
            username,
            password,
            gems: 500,
            pvpPoints: 0,
            pvpStreak: 0,
            inventory: {},
            equipmentInventory: {},
            team: [],
            currentEpisode: 1
        });

        await novoUser.save();
        res.json({ success: true });
    } catch (err) {
        console.error("Erro no registro:", err);
        res.status(500).json({ success: false, message: "Erro ao registrar usuário." });
    }
});

// Rota de Salvamento (Atualiza no MongoDB)
app.post('/api/save', async (req, res) => {
    try {
        const { username, data } = req.body;
        await User.findOneAndUpdate({ username }, { $set: data }, { new: true });
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao salvar dados:", err);
        res.status(500).json({ success: false, message: "Erro ao salvar progresso." });
    }
});

// Rota de Ranking Global (Top 10 do MongoDB)
app.get('/api/ranking', async (req, res) => {
    try {
        const top10 = await User.find()
            .sort({ pvpPoints: -1 })
            .limit(10)
            .select('username pvpPoints pvpStreak');
        res.json(top10);
    } catch (err) {
        console.error("Erro ao buscar ranking:", err);
        res.status(500).json([]);
    }
});

// ==========================================
// SOCKET.IO - MULTIPLAYER EM TEMPO REAL
// ==========================================
let salasBoss = [];
let filaPvp = [];

io.on('connection', (socket) => {
    console.log(`Novo usuário conectado via Socket: ${socket.id}`);

    // --- BOSS RAID / PARTYS ---
    socket.on('pedir_salas_boss', () => {
        socket.emit('lista_salas_boss', salasBoss);
    });

    socket.on('criar_party_boss', (data) => {
        const novaParty = {
            id: 'party_' + Date.now(),
            partyName: data.partyName,
            bossType: data.bossType,
            leader: data.username,
            members: [
                { username: data.username, shinobi: null, ready: false }
            ]
        };

        salasBoss.push(novaParty);
        socket.join(novaParty.id);
        
        // Responde especificamente para quem criou a sala abrir o painel de espera
        socket.emit('party_criada_sucesso', novaParty);
        // Atualiza o lobby para todos os outros players
        io.emit('lista_salas_boss', salasBoss);
    });

    socket.on('entrar_party_boss', (data) => {
        const party = salasBoss.find(s => s.id === data.partyId);
        if (party && party.members.length < 3) {
            if (!party.members.some(m => m.username === data.username)) {
                party.members.push({ username: data.username, shinobi: null, ready: false });
            }
            socket.join(party.id);
            socket.emit('entrar_party_sucesso', party);
            io.emit('atualizar_party', party);
        }
    });

    socket.on('sair_party_boss', (data) => {
        const party = salasBoss.find(s => s.id === data.partyId);
        if (party) {
            socket.leave(party.id);
            party.members = party.members.filter(m => m.username !== data.username);
            if (party.members.length === 0) {
                salasBoss = salasBoss.filter(s => s.id !== data.partyId);
            } else if (party.leader === data.username) {
                party.leader = party.members[0].username;
            }
            io.emit('atualizar_party', party);
            io.emit('lista_salas_boss', salasBoss);
        }
    });

    socket.on('escolher_shinobi_party', (data) => {
        const party = salasBoss.find(s => s.id === data.partyId);
        if (party) {
            const membro = party.members.find(m => m.username === data.username);
            if (membro) {
                membro.shinobi = data.shinobi;
                io.emit('atualizar_party', party);
            }
        }
    });

    socket.on('toggle_pronto_party', (data) => {
        const party = salasBoss.find(s => s.id === data.partyId);
        if (party) {
            const membro = party.members.find(m => m.username === data.username);
            if (membro && membro.shinobi) {
                membro.ready = !membro.ready;
                io.emit('atualizar_party', party);
            }
        }
    });

    socket.on('lider_iniciar_boss', (data) => {
        const party = salasBoss.find(s => s.id === data.partyId);
        if (party) {
            io.to(party.id).emit('iniciar_batalha_boss_coop', party);
        }
    });

    // --- PVP RANQUEADO MATCHMAKING ---
    socket.on('buscar_pvp', (data) => {
        // Remove da fila caso já estivesse
        filaPvp = filaPvp.filter(item => item.socketId !== socket.id);

        const rivalIndex = filaPvp.findIndex(item => item.username !== data.username);

        if (rivalIndex !== -1) {
            // Encontrou um oponente na fila
            const rival = filaPvp.splice(rivalIndex, 1)[0];

            // Notifica ambos os jogadores com os dados do rival
            io.to(rival.socketId).emit('partida_encontrada', {
                rival: { username: data.username, team: data.team, points: data.points }
            });
            socket.emit('partida_encontrada', {
                rival: { username: rival.username, team: rival.team, points: rival.points }
            });
        } else {
            // Adiciona na fila de espera
            filaPvp.push({
                socketId: socket.id,
                username: data.username,
                elo: data.elo,
                points: data.points,
                team: data.team
            });
        }
    });

    socket.on('cancelar_pvp', () => {
        filaPvp = filaPvp.filter(item => item.socketId !== socket.id);
    });

    socket.on('disconnect', () => {
        console.log(`Usuário desconectado: ${socket.id}`);
        filaPvp = filaPvp.filter(item => item.socketId !== socket.id);
        
        // Remove de salas de Boss caso estivesse em alguma
        salasBoss.forEach((party, index) => {
            party.members = party.members.filter(m => m.username !== socket.username);
            if (party.members.length === 0) {
                salasBoss.splice(index, 1);
            }
        });
        io.emit('lista_salas_boss', salasBoss);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});