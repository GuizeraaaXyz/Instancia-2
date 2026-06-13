import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mineflayer from 'mineflayer';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));
app.use(express.json());

app.use((req, res, next) => {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    next();
});

// ═══════════════════════════════════════════════════════════════
// ARMAZENAMENTO EM MEMÓRIA
// ═══════════════════════════════════════════════════════════════

let bots = [];
let nextBotId = 1;
let globalConfig = { webServerPort: process.env.PORT || 3000 };

// ═══════════════════════════════════════════════════════════════
// BOTS PRÉ-CONFIGURADOS
// ═══════════════════════════════════════════════════════════════

const PRECONFIGURED_BOTS = [
    {
        nome: "GatoDoMato_",
        server: "healtzcraft.com",
        port: 25565,
        version: "1.21.4",
        senha: "250719802023",
        autoSequence: true,
        commands: ["/login {senha}", "/skyblock", "/ac"]
    },
    {
        nome: "npx_DevCraft",
        server: "healtzcraft.com",
        port: 25565,
        version: "1.21.4",
        senha: "250719802023",
        autoSequence: true,
        commands: ["/login {senha}", "/skyblock", "/ac"]
    },
    {
        nome: "npm_install",
        server: "healtzcraft.com",
        port: 25565,
        version: "1.21.4",
        senha: "250719802023",
        autoSequence: true,
        commands: ["/login {senha}", "/skyblock", "/ac"]
    }
];

function initializePreconfiguredBots() {
    if (bots.length === 0) {
        console.log('\n🎮 Inicializando bots pré-configurados...\n');
        PRECONFIGURED_BOTS.forEach((botConfig, i) => {
            const newBot = {
                id: nextBotId++,
                nome: botConfig.nome,
                server: botConfig.server,
                port: botConfig.port,
                version: botConfig.version,
                senha: botConfig.senha,
                status: 'offline',
                running: false,
                autoSequence: botConfig.autoSequence,
                commands: botConfig.commands,
                reconnectAttempts: 0,
                connecting: false,
                bot: null,
                commandScheduler: null,
                reconnectTimeout: null,
                resourcePackReady: false,
                captchaPending: false
            };
            bots.push(newBot);
            console.log(`✅ Bot pré-configurado: ${botConfig.nome}`);

            // Inicia com delay escalonado para evitar flood no servidor
            setTimeout(() => {
                newBot.running = true;
                createBot(newBot.id);
            }, i * 8000); // 0s, 8s, 16s
        });
        console.log(`\n📊 Total: ${bots.length} bots\n`);
    }
}

// ═══════════════════════════════════════════════════════════════
// BACKOFF EXPONENCIAL
// ═══════════════════════════════════════════════════════════════

function getReconnectDelay(attempts) {
    const base = 30000;
    const delay = base * Math.pow(2, Math.min(attempts, 3));
    return Math.min(delay, 300000);
}

// ═══════════════════════════════════════════════════════════════
// SISTEMA DE COMANDOS
// ═══════════════════════════════════════════════════════════════

class CommandScheduler {
    constructor(bot, botData) {
        this.bot = bot;
        this.botData = botData;
        this.isRunning = false;
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async executeCommand(cmd) {
        if (!this.bot?.entity || this.botData.status !== 'online') return false;
        let text = cmd
            .replace('{senha}', this.botData.senha || '')
            .replace('{nome}', this.botData.nome);
        this.bot.chat(text);
        console.log(`[${this.botData.nome}] 💬 ${text}`);
        return true;
    }

    async start() {
        if (this.isRunning) return;
        if (!this.botData.commands || this.botData.commands.length === 0) {
            console.log(`[${this.botData.nome}] ⚠️ Nenhum comando`);
            return;
        }

        this.isRunning = true;

        // Aguarda resource pack antes de qualquer comando (max 20s)
        console.log(`[${this.botData.nome}] ⏳ Aguardando resource pack...`);
        let waitTime = 0;
        while (!this.botData.resourcePackReady && waitTime < 20000) {
            await this.delay(500);
            waitTime += 500;
        }

        if (this.botData.resourcePackReady) {
            console.log(`[${this.botData.nome}] ✅ Resource pack pronto!`);
            await this.delay(3000);
        } else {
            console.log(`[${this.botData.nome}] ⚠️ Sem resource pack, continuando...`);
        }

        console.log(`[${this.botData.nome}] 🚀 Executando comandos...`);

        for (let i = 0; i < this.botData.commands.length; i++) {
            if (!this.isRunning || this.botData.status !== 'online') break;

            const cmd = this.botData.commands[i];
            if (!cmd?.trim()) continue;

            if (cmd.includes('/ac')) {
                console.log(`[${this.botData.nome}] ⏳ Aguardando 2s antes do /ac...`);
                await this.delay(2000);
            }

            await this.executeCommand(cmd);

            if (i === 0) {
                console.log(`[${this.botData.nome}] ⏳ Aguardando 5s...`);
                await this.delay(5000);
            } else if (i === 1) {
                console.log(`[${this.botData.nome}] ⏳ Aguardando 8s...`);
                await this.delay(8000);
            }
        }

        console.log(`[${this.botData.nome}] ✅ Comandos finalizados! Bot em standby.`);
        this.isRunning = false;
    }

    stop() { this.isRunning = false; }
}

// ═══════════════════════════════════════════════════════════════
// GERENCIAMENTO DE BOTS
// ═══════════════════════════════════════════════════════════════

function getBotIndex(botId) { return bots.findIndex(b => b.id === botId); }

function destroyBot(botId) {
    const index = getBotIndex(botId);
    if (index === -1) return;
    const botData = bots[index];

    if (botData.commandScheduler) { botData.commandScheduler.stop(); botData.commandScheduler = null; }
    if (botData.reconnectTimeout) { clearTimeout(botData.reconnectTimeout); botData.reconnectTimeout = null; }
    if (botData.bot) {
        try { botData.bot.removeAllListeners(); botData.bot.quit(); } catch(e) {}
        botData.bot = null;
    }

    botData.status = 'offline';
    botData.connecting = false;
    botData.resourcePackReady = false;
    botData.captchaPending = false;
    bots[index] = botData;
    io.emit('botStatus', { id: botId, status: 'offline', nome: botData.nome });
}

function scheduleReconnect(botId) {
    const index = getBotIndex(botId);
    if (index === -1) return;
    const botData = bots[index];
    if (!botData.running) return;

    botData.reconnectAttempts = (botData.reconnectAttempts || 0) + 1;
    const delay = getReconnectDelay(botData.reconnectAttempts);
    console.log(`[${botData.nome}] 🔄 Tentativa ${botData.reconnectAttempts} — reconectando em ${delay / 1000}s`);

    botData.reconnectTimeout = setTimeout(() => {
        botData.reconnectTimeout = null;
        createBot(botId);
    }, delay);
    bots[index] = botData;
}

function createBot(botId) {
    const index = getBotIndex(botId);
    if (index === -1) return;
    const botData = bots[index];

    // Guard: evita conexões duplicadas
    if (botData.connecting || botData.status === 'online') {
        console.log(`[${botData.nome}] ⚠️ Já conectando/online, ignorando`);
        return;
    }

    destroyBot(botId);

    botData.connecting = true;
    botData.status = 'connecting';
    botData.resourcePackReady = false;
    botData.captchaPending = false;
    bots[index] = botData;

    io.emit('botStatus', { id: botId, status: 'connecting', nome: botData.nome });
    console.log(`[${botData.nome}] 🔌 Conectando a ${botData.server}:${botData.port}`);

    const bot = mineflayer.createBot({
        host: botData.server,
        port: botData.port || 25565,
        username: botData.nome,
        version: botData.version || '1.21.4',
        auth: 'offline',
        connectTimeout: 30000,
        keepAlive: true,
        checkTimeoutInterval: 30000,
        viewDistance: 'tiny', // reduz processamento
        disableChatSigning: true,
        skipValidation: true,
        acceptResourcePack: true
    });

    botData.bot = bot;
    bots[index] = botData;

    // Resource pack
    bot.on('resourcePack', () => {
        console.log(`[${botData.nome}] 📦 Resource pack! Aceitando...`);
        try { bot.acceptResourcePack(); } catch(e) {}
        botData.resourcePackReady = true;
        bots[index] = botData;
    });

    // Captcha via mapa
    bot.on('map', (map) => {
        if (!botData.captchaPending) {
            console.log(`[${botData.nome}] 🗺️ Mapa captcha recebido!`);
            botData.captchaPending = true;
            bots[index] = botData;

            io.emit('captchaMap', {
                botId: botId,
                botNome: botData.nome,
                data: Array.from(map.data)
            });
        }
    });

    bot.once('spawn', () => {
        console.log(`[${botData.nome}] ✅ Conectado!`);
        botData.connecting = false;
        botData.status = 'online';
        botData.reconnectAttempts = 0;
        bots[index] = botData;

        io.emit('botStatus', { id: botId, status: 'online', nome: botData.nome });

        // Inicia comandos — o CommandScheduler já aguarda o resource pack internamente
        setTimeout(() => {
            if (botData.status === 'online') {
                botData.commandScheduler = new CommandScheduler(bot, botData);
                botData.commandScheduler.start();
                bots[index] = botData;
            }
        }, 2000);
    });

    bot.on('error', (err) => {
        if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) return;
        if (err.message?.includes('ETIMEDOUT')) return;
        console.log(`[${botData.nome}] ⚠️ ${err.message}`);
    });

    bot.on('end', () => {
        console.log(`[${botData.nome}] ❌ Desconectado`);
        if (botData.commandScheduler) { botData.commandScheduler.stop(); botData.commandScheduler = null; }
        botData.status = 'offline';
        botData.connecting = false;
        botData.bot = null;
        botData.resourcePackReady = false;
        botData.captchaPending = false;
        bots[index] = botData;
        io.emit('botStatus', { id: botId, status: 'offline', nome: botData.nome });
        scheduleReconnect(botId);
    });

    bot.on('kicked', (reason) => {
        let msg = '';
        try {
            const parsed = typeof reason === 'string' ? JSON.parse(reason) : reason;
            const extra = parsed?.value?.extra?.value?.value;
            msg = extra?.map(e => e?.text?.value || '').join('') || JSON.stringify(reason);
        } catch(e) { msg = String(reason); }

        console.log(`[${botData.nome}] 🚫 Kick: ${msg.substring(0, 150)}`);
        botData.status = 'kicked';
        botData.connecting = false;
        botData.resourcePackReady = false;
        botData.captchaPending = false;
        bots[index] = botData;
        io.emit('botStatus', { id: botId, status: 'kicked', nome: botData.nome });
        scheduleReconnect(botId);
    });
}

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/bots', (req, res) => {
    res.json(bots.map(b => ({
        id: b.id, nome: b.nome, server: b.server, port: b.port,
        version: b.version, status: b.status, running: b.running || false,
        autoSequence: b.autoSequence || false, commandsCount: b.commands?.length || 0,
        captchaPending: b.captchaPending || false
    })));
});

app.get('/api/bots/stats', (req, res) => {
    res.json({
        total: bots.length,
        online: bots.filter(b => b.status === 'online').length,
        offline: bots.filter(b => b.status === 'offline').length,
        connecting: bots.filter(b => b.status === 'connecting').length,
        kicked: bots.filter(b => b.status === 'kicked').length,
        running: bots.filter(b => b.running).length,
        uptime: process.uptime()
    });
});

app.get('/api/bot/:id', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    res.json({
        id: bot.id, nome: bot.nome, server: bot.server, port: bot.port,
        version: bot.version, senha: bot.senha, status: bot.status,
        running: bot.running, autoSequence: bot.autoSequence,
        commands: bot.commands || [], captchaPending: bot.captchaPending || false
    });
});

app.post('/api/bot/create', (req, res) => {
    const { nome, server, port, senha, version, autoSequence } = req.body;
    if (!nome || !server) return res.status(400).json({ error: 'Nome e servidor são obrigatórios' });
    const newBot = {
        id: nextBotId++, nome, server, port: port || 25565,
        version: version || '1.21.4', senha: senha || '',
        status: 'offline', running: false,
        autoSequence: autoSequence !== undefined ? autoSequence : true,
        commands: [], reconnectAttempts: 0, connecting: false,
        bot: null, commandScheduler: null, reconnectTimeout: null,
        resourcePackReady: false, captchaPending: false
    };
    bots.push(newBot);
    console.log(`✅ Bot criado: ${nome}`);
    res.json({ success: true, id: newBot.id });
});

app.post('/api/bot/:id/start', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    bot.running = true;
    bot.reconnectAttempts = 0;
    createBot(bot.id);
    res.json({ success: true });
});

app.post('/api/bot/:id/stop', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    bot.running = false;
    bot.reconnectAttempts = 0;
    destroyBot(bot.id);
    res.json({ success: true });
});

app.delete('/api/bot/:id', (req, res) => {
    const index = bots.findIndex(b => b.id === parseInt(req.params.id));
    if (index === -1) return res.status(404).json({ error: 'Bot não encontrado' });
    bots[index].running = false;
    destroyBot(bots[index].id);
    bots.splice(index, 1);
    res.json({ success: true });
});

app.post('/api/bot/:id/commands', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    let commands = req.body.commands;
    if (typeof commands === 'string') commands = [commands];
    if (!Array.isArray(commands) && req.body.command) commands = [req.body.command];
    if (!Array.isArray(commands)) commands = [];
    commands = commands.filter(cmd => cmd && cmd.trim().length > 0);
    bot.commands = commands;
    console.log(`[${bot.nome}] 📝 ${commands.length} comando(s) salvos`);
    if (bot.status === 'online' && bot.commandScheduler) {
        bot.commandScheduler.stop();
        if (bot.autoSequence && commands.length > 0) {
            bot.commandScheduler = new CommandScheduler(bot.bot, bot);
            bot.commandScheduler.start();
        }
    }
    res.json({ success: true, commands });
});

app.post('/api/bot/:id/say', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensagem obrigatória' });
    if (bot.status === 'online' && bot.bot?.entity) {
        const msg = message.replace('{senha}', bot.senha || '').replace('{nome}', bot.nome);
        bot.bot.chat(msg);
        // Se enviou captcha, marca como resolvido
        if (bot.captchaPending) {
            bot.captchaPending = false;
            console.log(`[${bot.nome}] ✅ Captcha respondido: ${msg}`);
        }
        console.log(`[${bot.nome}] 💬 Manual: ${msg}`);
        res.json({ success: true, message: msg });
    } else {
        res.status(400).json({ error: 'Bot offline' });
    }
});

app.post('/api/bot/:id/toggleAuto', (req, res) => {
    const bot = bots.find(b => b.id === parseInt(req.params.id));
    if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });
    bot.autoSequence = !bot.autoSequence;
    res.json({ success: true, autoSequence: bot.autoSequence });
});

app.get('/api/config', (req, res) => res.json(globalConfig));
app.post('/api/config', (req, res) => {
    globalConfig = { ...globalConfig, ...req.body };
    res.json({ success: true });
});

app.post('/api/bots/startAll', (req, res) => {
    const offline = bots.filter(b => !b.running);
    offline.forEach((bot, i) => {
        bot.running = true;
        bot.reconnectAttempts = 0;
        setTimeout(() => createBot(bot.id), i * 5000);
    });
    res.json({ success: true, started: offline.length });
});

app.post('/api/bots/stopAll', (req, res) => {
    const running = bots.filter(b => b.status === 'online' || b.status === 'connecting');
    running.forEach(bot => { bot.running = false; bot.reconnectAttempts = 0; destroyBot(bot.id); });
    res.json({ success: true, stopped: running.length });
});

// ═══════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    console.log('📡 Dashboard conectado');
    socket.emit('botList', bots.map(b => ({
        id: b.id, nome: b.nome, server: b.server,
        status: b.status, running: b.running, autoSequence: b.autoSequence,
        captchaPending: b.captchaPending || false
    })));
});

// ═══════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════

const PORT = globalConfig.webServerPort;
initializePreconfiguredBots();

server.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║      🤖 BOTCRAFT v3.1                             ║`);
    console.log(`╠════════════════════════════════════════════════════╣`);
    console.log(`║  🌐 Dashboard: http://localhost:${PORT}                  ║`);
    console.log(`║  🤖 Bots: ${bots.length}                                    ║`);
    console.log(`║  🗺️  Captcha: Sistema manual via dashboard         ║`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
    bots.forEach(bot => {
        console.log(`   🤖 ${bot.nome} → ${bot.server}:${bot.port}`);
        console.log(`      📝 Comandos: ${bot.commands.join(' → ')}\n`);
    });
});