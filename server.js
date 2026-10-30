const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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

// Armazenamento em memória (ou banco de dados) para as salas ativas e usuários
let salasBoss = [];
let usuariosLogados = {}; // Simulação de banco de dados para testes

// Rotas da API REST (Login, Registro, Salvar, Ranking)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    // Adicione a sua lógica real de login aqui
    if (!usuariosLogados[username]) {
        usuariosLogados[username] = {
            username,
            gems: 500,
            pvpPoints: 0,
            pvpStreak: 0,
            inventory: {},
            equipmentInventory: {},
            team: [],
            currentEpisode: 1
        };
    }
    res.json({ success: true, user: usuariosLogados[username] });
});

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (usuariosLogados[username]) {
        return res.json({ success: false, message: "Usuário já existe!" });
    }
    usuariosLogados[username] = {
        username,
        gems: 500,
        pvpPoints: 0,
        pvpStreak: 0,
        inventory: {},
        equipmentInventory: {},
        team: [],
        currentEpisode: 1
    };
    res.json({ success: true });
});

app.post('/api/save', (req, res) => {
    const { username, data } = req.body;
    if (usuariosLogados[username]) {
        usuariosLogados[username] = { ...usuariosLogados[username], ...data };
    }
    res.json({ success: true });
});

app.get('/api/ranking', (req, res) => {
    const ranking = Object.values(usuariosLogados)
        .sort((a, b) => b.pvpPoints - a.pvpPoints)
        .slice(0, 10);
    res.json(ranking);
});

// Socket.io - Comunicação em Tempo Real (Boss Raid e PvP)
io.on('connection', (socket) => {
    console.log(`Novo usuário conectado: ${socket.id}`);

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

        // Responde especificamente para o criador abrindo a sala de espera
        socket.emit('party_criada_sucesso', novaParty);

        // Atualiza a lista de salas para todos no lobby
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
            io.emit('iniciar_batalha_boss_coop', party);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Usuário desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});