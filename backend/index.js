require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { Sequelize, DataTypes } = require('sequelize');

// === IMPORTAÇÃO DO WHATSAPP (CORRIGIDO) ===
const WhatsAppClient = require('./whatsapp-api/evolution');
const createWhatsAppRoutes = require('./whatsapp-api/routes');
const MessageTemplates = require('./whatsapp-api/messages');

// --- CONFIGURAÇÃO DO BANCO DE DADOS ---
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    }
});

// --- MODELOS DO BANCO (ATUALIZADOS PARA WHATSAPP) ---
const Codigo = sequelize.define('Codigo', {
    codigo: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'disponivel' // disponivel, vendido
    },
    transaction_id: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {});

const Pagamento = sequelize.define('Pagamento', {
    transaction_id: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    external_id: {
        type: DataTypes.STRING,
        allowNull: true
    },
    nome: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: true }, // Agora opcional
    whatsapp: { type: DataTypes.STRING, allowNull: true }, // Novo campo
    plano: { type: DataTypes.STRING, allowNull: false },
    valor: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending, approved, cancelled
    codigo_entregue: { type: DataTypes.STRING, allowNull: true },
    whatsapp_enviado: { type: DataTypes.BOOLEAN, defaultValue: false } // Controle de envio
}, {});

// --- INICIALIZAR WHATSAPP CLIENT ---
const whatsappClient = new WhatsAppClient();
let whatsappEnabled = process.env.WHATSAPP_ENABLED === 'true';

// --- FUNÇÃO DE MIGRAÇÃO AUTOMÁTICA (ATUALIZADA) ---
async function executarMigracoes() {
    const queryInterface = sequelize.getQueryInterface();
    
    try {
        console.log('🔄 Iniciando migrações automáticas...');
        
        const pagamentosColumns = await queryInterface.describeTable('Pagamentos').catch(() => ({}));
        const codigosColumns = await queryInterface.describeTable('Codigos').catch(() => ({}));

        if (codigosColumns.id_pagamento_mp && !codigosColumns.transaction_id) {
            console.log('📝 Migração 1: Renomeando id_pagamento_mp → transaction_id na tabela Codigos');
            await queryInterface.addColumn('Codigos', 'transaction_id', { type: DataTypes.STRING, allowNull: true });
            await sequelize.query('UPDATE "Codigos" SET transaction_id = id_pagamento_mp WHERE id_pagamento_mp IS NOT NULL');
            await queryInterface.removeColumn('Codigos', 'id_pagamento_mp');
            console.log('✅ Migração 1 concluída: Codigos.transaction_id');
        }
        
        if (!pagamentosColumns.external_id) {
            console.log('📝 Migração 2: Adicionando coluna external_id na tabela Pagamentos');
            await queryInterface.addColumn('Pagamentos', 'external_id', { type: DataTypes.STRING, allowNull: true });
            console.log('✅ Migração 2 concluída: Pagamentos.external_id');
        }
        
        if (pagamentosColumns.id_pagamento_mp && !pagamentosColumns.transaction_id) {
            console.log('📝 Migração 3: Renomeando id_pagamento_mp → transaction_id na tabela Pagamentos');
            await queryInterface.addColumn('Pagamentos', 'transaction_id', { type: DataTypes.STRING, allowNull: true, unique: true });
            await sequelize.query('UPDATE "Pagamentos" SET transaction_id = id_pagamento_mp WHERE id_pagamento_mp IS NOT NULL');
            await queryInterface.removeColumn('Pagamentos', 'id_pagamento_mp');
            console.log('✅ Migração 3 concluída: Pagamentos.transaction_id');
        }
        
        if (!pagamentosColumns.whatsapp) {
            console.log('📝 Migração 4: Adicionando coluna whatsapp na tabela Pagamentos');
            await queryInterface.addColumn('Pagamentos', 'whatsapp', { type: DataTypes.STRING, allowNull: true });
            console.log('✅ Migração 4 concluída: Pagamentos.whatsapp');
        }
        
        if (!pagamentosColumns.whatsapp_enviado) {
            console.log('📝 Migração 5: Adicionando coluna whatsapp_enviado na tabela Pagamentos');
            await queryInterface.addColumn('Pagamentos', 'whatsapp_enviado', { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false });
            console.log('✅ Migração 5 concluída: Pagamentos.whatsapp_enviado');
        }
        
        if (pagamentosColumns.email && !pagamentosColumns.email.allowNull) {
            console.log('📝 Migração 6: Tornando email opcional na tabela Pagamentos');
            await queryInterface.changeColumn('Pagamentos', 'email', { type: DataTypes.STRING, allowNull: true });
            console.log('✅ Migração 6 concluída: Pagamentos.email agora é opcional');
        }
        
        console.log('🎉 Todas as migrações foram verificadas.');
        
    } catch (error) {
        console.error('❌ Erro durante migração:', error);
    }
}

const app = express();
app.use(cors());
app.use(express.json());

// --- SERVIR ARQUIVOS ESTÁTICOS ---
app.use(express.static(__dirname));

// --- USAR ROTAS DO WHATSAPP ---
app.use('/api/whatsapp', createWhatsAppRoutes(whatsappClient));

// ===================================================================
//                    🚀 PÁGINA QR CODE WHATSAPP (CORRIGIDA)
// ===================================================================

app.get('/whatsapp-qr.html', (req, res) => {
  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp QR Code - UniTV</title>
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .container { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); text-align: center; max-width: 500px; width: 100%; }
        .logo { font-size: 2.5em; color: #667eea; margin-bottom: 10px; font-weight: bold; }
        .subtitle { color: #666; margin-bottom: 30px; font-size: 1.1em; }
        .qr-container { background: #f8f9fa; padding: 30px; border-radius: 15px; margin: 30px 0; border: 2px dashed #dee2e6; min-height: 250px; display: flex; align-items: center; justify-content: center; flex-direction: column; }
        #qrcode { display: flex; justify-content: center; align-items: center; flex-direction: column; gap: 15px; }
        .loading { display: flex; flex-direction: column; align-items: center; gap: 15px; }
        .spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .status { margin-top: 20px; padding: 15px; border-radius: 10px; font-weight: bold; word-break: break-word; }
        .status.loading { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
        .status.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .status.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .instructions { background: #e3f2fd; padding: 20px; border-radius: 10px; margin-top: 20px; text-align: left; }
        .instructions h3 { color: #1976d2; margin-bottom: 15px; text-align: center; }
        .instructions ol { color: #666; line-height: 1.6; padding-left: 20px; }
        .button-group { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
        .refresh-btn { background: #667eea; color: white; border: none; padding: 12px 24px; border-radius: 25px; font-size: 1em; cursor: pointer; transition: all 0.3s ease; }
        .refresh-btn:hover:not(:disabled) { background: #5a6fd8; transform: translateY(-2px); }
        .refresh-btn:disabled { background: #ccc; cursor: not-allowed; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">📱 UniTV</div>
        <div class="subtitle">Conectar WhatsApp Business</div>
        <div class="qr-container">
            <div id="loading" class="loading"><div class="spinner"></div><p>Carregando QR Code...</p></div>
            <div id="qrcode"></div>
            <div id="status" class="status" style="display: none;"></div>
        </div>
        <div class="instructions">
            <h3>📋 Como conectar:</h3>
            <ol>
                <li>Abra o <strong>WhatsApp Business</strong> no seu celular</li>
                <li>Toque em <strong>Menu (⋮)</strong> > <strong>Dispositivos conectados</strong></li>
                <li>Toque em <strong>Conectar um dispositivo</strong></li>
                <li>Aponte a câmera para o QR Code acima</li>
            </ol>
        </div>
        <div class="button-group">
            <button id="refreshBtn" class="refresh-btn" onclick="loadQRCode()" disabled>🔄 Tentar Novamente</button>
            <button id="checkStatusBtn" class="refresh-btn" onclick="checkConnectionStatus()" disabled>📊 Verificar Status</button>
        </div>
    </div>
    <script>
        let checkInterval;
        async function loadQRCode(retries = 5, delay = 2000) {
            const loading = document.getElementById('loading');
            const qrcodeContainer = document.getElementById('qrcode');
            const statusDiv = document.getElementById('status');
            const refreshBtn = document.getElementById('refreshBtn');
            loading.style.display = 'flex';
            qrcodeContainer.innerHTML = '';
            statusDiv.style.display = 'none';
            refreshBtn.disabled = true;
            for (let i = 0; i < retries; i++) {
                try {
                    console.log('Buscando QR Code (Tentativa ' + (i + 1) + '/' + retries + ')...');
                    const response = await fetch('/api/whatsapp/qr');
                    if (!response.ok) throw new Error('Falha na rede: ' + response.statusText);
                    const data = await response.json();
                    if (data.success && data.qrCode) {
                        loading.style.display = 'none';
                        await QRCode.toCanvas(qrcodeContainer, data.qrCode, { width: 250, margin: 2 });
                        statusDiv.className = 'status loading';
                        statusDiv.textContent = '✅ QR Code gerado! Escaneie com o WhatsApp.';
                        statusDiv.style.display = 'block';
                        startStatusCheck();
                        refreshBtn.disabled = false;
                        refreshBtn.textContent = '🔄 Atualizar QR Code';
                        return;
                    }
                    if (i < retries - 1) {
                        const loadingText = document.querySelector('#loading p');
                        if(loadingText) loadingText.textContent = 'Aguardando servidor... (' + (i + 1) + ')';
                        await new Promise(resolve => setTimeout(resolve, delay));
                    } else {
                        throw new Error(data.message || 'QR Code não disponível.');
                    }
                } catch (error) {
                    if (i >= retries - 1) {
                        loading.style.display = 'none';
                        statusDiv.className = 'status error';
                        statusDiv.textContent = '❌ Erro: ' + error.message;
                        statusDiv.style.display = 'block';
                        refreshBtn.disabled = false;
                        refreshBtn.textContent = '🔄 Tentar Novamente';
                    } else {
                         await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
        }
        async function checkConnectionStatus() {
            const statusDiv = document.getElementById('status');
            const qrcodeContainer = document.getElementById('qrcode');
            try {
                const response = await fetch('/api/whatsapp/status');
                const data = await response.json();
                if (data.connected) {
                    qrcodeContainer.innerHTML = '';
                    statusDiv.className = 'status success';
                    statusDiv.textContent = '🎉 WhatsApp conectado com sucesso!';
                    statusDiv.style.display = 'block';
                    if (checkInterval) clearInterval(checkInterval);
                }
            } catch (error) {
                console.error('Erro ao verificar status:', error);
            }
        }
        function startStatusCheck() {
            if (checkInterval) clearInterval(checkInterval);
            checkInterval = setInterval(checkConnectionStatus, 5000);
        }
        document.addEventListener('DOMContentLoaded', function() {
            const checkStatusBtn = document.getElementById('checkStatusBtn');
            function attemptLoad() {
                if (typeof QRCode !== 'undefined') {
                    checkStatusBtn.disabled = false;
                    loadQRCode();
                    checkConnectionStatus();
                } else {
                    setTimeout(attemptLoad, 100);
                }
            }
            attemptLoad();
        });
    </script>
</body>
</html>`;
  res.send(htmlContent);
});

// --- ROTAS ADICIONAIS PARA FACILITAR O ACESSO ---
app.get('/whatsapp', (req, res) => res.redirect('/whatsapp-qr.html'));
app.get('/qr', (req, res) => res.redirect('/whatsapp-qr.html'));

// ===================================================================
//                    FIM DA SEÇÃO QR CODE
// ===================================================================

// --- CONFIGURAÇÃO DA BUCKPAY ---
const BUCKPAY_API_BASE = 'https://api.realtechdev.com.br';
const BUCKPAY_SECRET_TOKEN = process.env.BUCKPAY_SECRET_TOKEN || 'sk_live_a74d213bb8682959c3449ee40c192791';

const buckpayClient = axios.create({
    baseURL: BUCKPAY_API_BASE,
    headers: {
        'Authorization': `Bearer ${BUCKPAY_SECRET_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Buckpay API'
    }
});

// === FUNÇÃO AUXILIAR PARA ENVIO DE WHATSAPP ===
async function enviarWhatsAppCodigo(nome, whatsapp, codigo, plano) {
    if (!whatsappEnabled || !whatsappClient.isConnected) {
        console.log('⚠️ WhatsApp desabilitado ou desconectado, pulando envio');
        return { success: false, reason: 'WhatsApp não disponível' };
    }
    
    try {
        const mensagem = MessageTemplates.codigoEntrega(nome, codigo, plano);
        const result = await whatsappClient.sendMessage(whatsapp, mensagem);
        
        if (result.success) {
            console.log(`✅ WhatsApp enviado para ${nome} (${whatsapp}): ${codigo}`);
        } else {
            console.error(`❌ Falha no WhatsApp para ${nome}:`, result.error);
        }
        
        return result;
    } catch (error) {
        console.error('❌ Erro ao enviar WhatsApp:', error);
        return { success: false, error: error.message };
    }
}

// ===================================================================
//                    ROTA DE PING PARA UPTIME MONITORING
// ===================================================================

// --- ROTA DE PING OTIMIZADA ---
app.get('/ping', (req, res) => {
    const whatsappStatus = whatsappClient.getConnectionStatus();
    res.status(200).json({ 
        status: 'online',
        service: 'UniTV Backend - BuckPay + WhatsApp',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '2.1.0',
        payment_provider: 'BuckPay',
        whatsapp: {
            enabled: whatsappEnabled,
            connected: whatsappStatus.connected,
            hasSession: whatsappStatus.hasSession
        }
    });
});

// --- ROTA DE HEALTH CHECK ---
app.get('/health', async (req, res) => {
    try {
        await sequelize.authenticate();
        const codigosDisponiveis = await Codigo.count({ where: { status: 'disponivel' } });
        const whatsappStatus = whatsappClient.getConnectionStatus();
        
        res.status(200).json({
            status: 'healthy',
            database: 'connected',
            codigosDisponiveis,
            whatsapp: whatsappStatus,
            timestamp: new Date().toISOString(),
            payment_provider: 'BuckPay'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ===================================================================
//                    ROTAS DE PAGAMENTO (ATUALIZADAS)
// ===================================================================

// --- FUNÇÃO AUXILIAR: GERAR EXTERNAL_ID ÚNICO ---
function gerarExternalId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `unitv_${timestamp}_${random}`;
}

// --- ROTA: GERAR PAGAMENTO (ATUALIZADA PARA WHATSAPP) ---
app.post('/api/gerar-pagamento', async (req, res) => {
    try {
        const { nome, email, whatsapp, plano, valor } = req.body;
        
        if (!nome || !plano || !valor || (!email && !whatsapp)) {
            return res.status(400).json({ erro: "Nome, plano, valor e (email ou WhatsApp) são obrigatórios." });
        }

        const externalId = gerarExternalId();
        const valorCentavos = Math.round(Number(valor) * 100);

        const buckpayBody = {
            external_id: externalId,
            payment_method: 'pix',
            amount: valorCentavos,
            buyer: {
                name: nome,
                email: email || `${whatsapp}@whatsapp.temp`
            }
        };

        const response = await buckpayClient.post('/v1/transactions', buckpayBody);
        const transaction = response.data.data;

        await Pagamento.create({
            transaction_id: transaction.id,
            external_id: externalId,
            nome,
            email: email || null,
            whatsapp: whatsapp || null,
            plano,
            valor: Number(valor),
            status: 'pending',
            whatsapp_enviado: false
        });

        res.json({
            sucesso: true,
            id_pagamento: transaction.id,
            qr_code_base64: transaction.pix.qrcode_base64,
            qr_code: transaction.pix.code
        });

    } catch (error) {
        console.error("ERRO DETALHADO DA BUCKPAY:", error.response?.data || error.message);
        return res.status(500).json({ erro: "Erro ao gerar cobrança PIX." });
    }
});

// --- WEBHOOK DA BUCKPAY (ATUALIZADO COM WHATSAPP) ---
app.post('/webhook', async (req, res) => {
    try {
        const { event, data } = req.body;

        if (event === 'transaction.processed' && data.status === 'paid') {
            const transactionId = data.id;
            const pagamentoLocal = await Pagamento.findOne({ where: { transaction_id: transactionId } });

            if (pagamentoLocal && pagamentoLocal.status === 'pending') {
                const t = await sequelize.transaction();
                try {
                    const codigo = await Codigo.findOne({ where: { status: 'disponivel' }, transaction: t, lock: t.LOCK.UPDATE });
                    if (!codigo) {
                        await t.rollback();
                        console.error('❌ CRÍTICO: Sem códigos em estoque! ID:', transactionId);
                        return res.status(200).json({ status: 'no_stock' });
                    }

                    await codigo.update({ status: 'vendido', transaction_id: transactionId }, { transaction: t });
                    await pagamentoLocal.update({ status: 'approved', codigo_entregue: codigo.codigo }, { transaction: t });
                    await t.commit();
                    
                    console.log('✅ SUCESSO! Código entregue:', codigo.codigo, 'para', pagamentoLocal.nome);

                    if (pagamentoLocal.whatsapp && whatsappEnabled) {
                        enviarWhatsAppCodigo(pagamentoLocal.nome, pagamentoLocal.whatsapp, codigo.codigo, pagamentoLocal.plano)
                            .then(result => {
                                if (result.success) {
                                    pagamentoLocal.update({ whatsapp_enviado: true }).then(() => console.log('✅ WhatsApp marcado como enviado.'));
                                }
                            });
                    }
                } catch (dbError) {
                    await t.rollback();
                    console.error('❌ Erro na transação do webhook:', dbError);
                }
            }
        }
        res.status(200).json({ status: 'received' });
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(500).json({ status: 'error' });
    }
});


// --- VERIFICAR STATUS DO PAGAMENTO (MANTÉM COMPATIBILIDADE) ---
app.post('/api/verificar-pagamento', async (req, res) => {
    try {
        const { id_pagamento } = req.body;
        const pagamento = await Pagamento.findOne({ where: { transaction_id: id_pagamento.toString() } });
        if (!pagamento) {
            return res.json({ sucesso: false, erro: 'Pagamento não encontrado' });
        }
        
        if (pagamento.status === 'approved' && pagamento.codigo_entregue) {
            return res.json({
                sucesso: true,
                status: 'approved',
                codigo: pagamento.codigo_entregue,
                nome: pagamento.nome,
                plano: pagamento.plano
            });
        }
        
        return res.json({ sucesso: true, status: pagamento.status });
    } catch (error) {
        console.error('Erro ao verificar pagamento:', error);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
});

// ===================================================================
//                    ROTAS DE ADMINISTRAÇÃO (MANTIDAS)
// ===================================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_adicionar.html'));
});

app.get('/obrigado.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'obrigado.html'));
});

app.post('/admin/adicionar', async (req, res) => {
    const { senha, codigos } = req.body;
    if (senha !== process.env.SENHA_ADMIN) {
        return res.status(401).json({ erro: "Senha incorreta." });
    }
    try {
        const listaCodigos = codigos.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const codigosParaCriar = listaCodigos.map(c => ({ codigo: c, status: 'disponivel' }));
        await Codigo.bulkCreate(codigosParaCriar, { ignoreDuplicates: true });
        return res.json({ mensagem: `✅ ${listaCodigos.length} códigos adicionados ao banco de dados com sucesso!` });
    } catch (error) {
        console.error("Erro ao adicionar códigos:", error);
        return res.status(500).json({ erro: "Erro ao salvar códigos no banco de dados." });
    }
});

app.get('/admin/status', async (req, res) => {
    try {
        const stats = await sequelize.query(
            `SELECT status, COUNT(*) as quantidade FROM "Codigos" GROUP BY status`, 
            { type: Sequelize.QueryTypes.SELECT }
        );
        const pagamentos = await Pagamento.count({ where: { status: 'approved' } });
        const whatsappStatus = whatsappClient.getConnectionStatus();
        
        res.json({
            codigos: stats,
            pagamentos_aprovados: pagamentos,
            payment_provider: 'BuckPay',
            whatsapp: whatsappStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Erro ao buscar status:", error);
        res.status(500).json({ erro: "Erro interno" });
    }
});

app.get('/admin/pagamentos', async (req, res) => {
    try {
        const pagamentos = await Pagamento.findAll({
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        
        res.json({
            pagamentos: pagamentos
        });
    } catch (error) {
        console.error("Erro ao buscar pagamentos:", error);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// ===================================================================
//                    MIDDLEWARE DE ERRO E INICIALIZAÇÃO
// ===================================================================

app.use((err, req, res, next) => {
    console.error('❌ Erro não tratado:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
});

app.use((req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Servidor UniTV-BuckPay+WhatsApp rodando na porta ${PORT}`);
    try {
        await sequelize.authenticate();
        console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
        
        await executarMigracoes();
        await sequelize.sync({ alter: false });
        console.log('✅ Tabelas sincronizadas.');
        
        if (whatsappEnabled) {
            console.log('📱 Inicializando WhatsApp...');
            setTimeout(async () => {
                try {
                    await whatsappClient.initialize();
                } catch (error) {
                    console.error('❌ Erro ao inicializar WhatsApp:', error);
                    whatsappEnabled = false;
                }
            }, 2000);
        } else {
            console.log('📱 WhatsApp desabilitado via variável de ambiente');
        }
        
    } catch (error) {
        console.error('❌ Não foi possível conectar ao banco de dados:', error);
    }
});
