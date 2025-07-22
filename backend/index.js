require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { Sequelize, DataTypes } = require('sequelize');

// === IMPORTAÇÃO DO WHATSAPP ===
const WhatsAppClient = require('./whatsapp/evolution');
const createWhatsAppRoutes = require('./whatsapp/routes');
const MessageTemplates = require('./whatsapp/messages');

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
        
        // 1. Verificar se coluna transaction_id existe na tabela Codigos
        const codigosColumns = await queryInterface.describeTable('Codigos');
        
        if (!codigosColumns.transaction_id && codigosColumns.id_pagamento_mp) {
            console.log('📝 Migração 1: Renomeando id_pagamento_mp → transaction_id na tabela Codigos');
            
            await queryInterface.addColumn('Codigos', 'transaction_id', {
                type: DataTypes.STRING,
                allowNull: true
            });
            
            await sequelize.query('UPDATE "Codigos" SET transaction_id = id_pagamento_mp WHERE id_pagamento_mp IS NOT NULL');
            await queryInterface.removeColumn('Codigos', 'id_pagamento_mp');
            
            console.log('✅ Migração 1 concluída: Codigos.transaction_id');
        }
        
        // 2. Verificar se coluna external_id existe na tabela Pagamentos
        const pagamentosColumns = await queryInterface.describeTable('Pagamentos');
        
        if (!pagamentosColumns.external_id) {
            console.log('📝 Migração 2: Adicionando coluna external_id na tabela Pagamentos');
            await queryInterface.addColumn('Pagamentos', 'external_id', {
                type: DataTypes.STRING,
                allowNull: true
            });
            console.log('✅ Migração 2 concluída: Pagamentos.external_id');
        }
        
        // 3. Verificar se precisa renomear id_pagamento_mp → transaction_id na tabela Pagamentos
        if (!pagamentosColumns.transaction_id && pagamentosColumns.id_pagamento_mp) {
            console.log('📝 Migração 3: Renomeando id_pagamento_mp → transaction_id na tabela Pagamentos');
            
            await queryInterface.addColumn('Pagamentos', 'transaction_id', {
                type: DataTypes.STRING,
                allowNull: true,
                unique: true
            });
            
            await sequelize.query('UPDATE "Pagamentos" SET transaction_id = id_pagamento_mp WHERE id_pagamento_mp IS NOT NULL');
            await queryInterface.removeColumn('Pagamentos', 'id_pagamento_mp');
            
            console.log('✅ Migração 3 concluída: Pagamentos.transaction_id');
        }
        
        // === NOVAS MIGRAÇÕES PARA WHATSAPP ===
        
        // 4. Adicionar coluna whatsapp
        if (!pagamentosColumns.whatsapp) {
            console.log('📝 Migração 4: Adicionando coluna whatsapp na tabela Pagamentos');
            await queryInterface.addColumn('Pagamentos', 'whatsapp', {
                type: DataTypes.STRING,
                allowNull: true
            });
            console.log('✅ Migração 4 concluída: Pagamentos.whatsapp');
        }
        
        // 5. Adicionar coluna whatsapp_enviado
        if (!pagamentosColumns.whatsapp_enviado) {
            console.log('📝 Migração 5: Adicionando coluna whatsapp_enviado na tabela Pagamentos');
            await queryInterface.addColumn('Pagamentos', 'whatsapp_enviado', {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
                allowNull: false
            });
            console.log('✅ Migração 5 concluída: Pagamentos.whatsapp_enviado');
        }
        
        // 6. Tornar email opcional (permitir NULL)
        if (pagamentosColumns.email && !pagamentosColumns.email.allowNull) {
            console.log('📝 Migração 6: Tornando email opcional na tabela Pagamentos');
            await queryInterface.changeColumn('Pagamentos', 'email', {
                type: DataTypes.STRING,
                allowNull: true
            });
            console.log('✅ Migração 6 concluída: Pagamentos.email agora é opcional');
        }
        
        console.log('🎉 Todas as migrações foram executadas com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro durante migração:', error);
        throw error;
    }
}

const app = express();
app.use(cors());
app.use(express.json());

// --- SERVIR ARQUIVOS ESTÁTICOS ---
app.use(express.static(__dirname));

// --- USAR ROTAS DO WHATSAPP ---
app.use('/api/whatsapp', createWhatsAppRoutes(whatsappClient));

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
        
        // Validação: nome e plano são obrigatórios, email OU whatsapp
        if (!nome || !plano || !valor) {
            return res.status(400).json({ erro: "Nome, plano e valor são obrigatórios." });
        }
        
        if (!email && !whatsapp) {
            return res.status(400).json({ erro: "Email ou WhatsApp é obrigatório." });
        }

        // Gerar external_id único
        const externalId = gerarExternalId();
        
        // Converter valor para centavos
        const valorCentavos = Math.round(Number(valor) * 100);

        // Criar transação na BuckPay
        const buckpayBody = {
            external_id: externalId,
            payment_method: 'pix',
            amount: valorCentavos,
            buyer: {
                name: nome,
                email: email || `${whatsapp}@whatsapp.temp` // Email temporário se não fornecido
            }
        };

        console.log('🔥 Criando transação BuckPay:', {
            external_id: externalId,
            valor: valor,
            valor_centavos: valorCentavos,
            email: email || 'WhatsApp only',
            whatsapp: whatsapp || 'Email only'
        });

        const response = await buckpayClient.post('/v1/transactions', buckpayBody);
        const transaction = response.data.data;

        console.log('✅ Transação BuckPay criada:', {
            id: transaction.id,
            external_id: externalId,
            status: transaction.status
        });

        // Salvar no banco de dados (com suporte a ambos)
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
        console.log('📩 Webhook BuckPay recebido:', JSON.stringify(req.body, null, 2));
        
        const { event, data } = req.body;

        if (event === 'transaction.processed' && data.status === 'paid') {
            const transactionId = data.id;
            console.log('💳 Processando transação paga ID:', transactionId);

            const pagamentoLocal = await Pagamento.findOne({
                where: { transaction_id: transactionId }
            });

            console.log('🔍 Pagamento local encontrado:', pagamentoLocal ? 'SIM' : 'NÃO');

            if (pagamentoLocal && pagamentoLocal.status === 'pending') {
                console.log('🔄 Iniciando entrega do código...');
                
                const t = await sequelize.transaction();
                
                try {
                    const codigo = await Codigo.findOne({ 
                        where: { status: 'disponivel' },
                        transaction: t
                    });

                    console.log('📦 Código disponível encontrado:', codigo ? codigo.codigo : 'NENHUM');

                    if (codigo) {
                        // Marcar código como vendido
                        await codigo.update({
                            status: 'vendido',
                            transaction_id: transactionId
                        }, { transaction: t });
                        
                        // Atualizar pagamento no nosso banco
                        await pagamentoLocal.update({
                            status: 'approved',
                            codigo_entregue: codigo.codigo
                        }, { transaction: t });

                        await t.commit();
                        
                        console.log('✅ SUCESSO! Código entregue:', codigo.codigo);
                        console.log('📧 Cliente:', pagamentoLocal.nome, '- Plano:', pagamentoLocal.plano);
                        
                        // === ENVIAR VIA WHATSAPP SE DISPONÍVEL ===
                        if (pagamentoLocal.whatsapp && whatsappEnabled) {
                            console.log('📱 Enviando código via WhatsApp...');
                            
                            // Não aguardar o WhatsApp para não travar o webhook
                            setImmediate(async () => {
                                const whatsappResult = await enviarWhatsAppCodigo(
                                    pagamentoLocal.nome,
                                    pagamentoLocal.whatsapp,
                                    codigo.codigo,
                                    pagamentoLocal.plano
                                );
                                
                                if (whatsappResult.success) {
                                    // Marcar como enviado no banco
                                    await pagamentoLocal.update({ whatsapp_enviado: true });
                                    console.log('✅ WhatsApp marcado como enviado');
                                }
                            });
                        }
                        
                        res.status(200).json({ 
                            status: 'success', 
                            codigo_entregue: codigo.codigo,
                            cliente: pagamentoLocal.email || pagamentoLocal.whatsapp,
                            whatsapp_scheduled: !!pagamentoLocal.whatsapp
                        });
                        return;
                    } else {
                        await t.rollback();
                        console.error('❌ CRÍTICO: Sem códigos em estoque! ID:', transactionId);
                        
                        res.status(200).json({ status: 'no_stock', message: 'Sem códigos em estoque' });
                        return;
                    }
                } catch (error) {
                    await t.rollback();
                    console.error('❌ Erro na transação:', error);
                    res.status(500).json({ status: 'error', error: error.message });
                    return;
                }
            } else if (pagamentoLocal && pagamentoLocal.status === 'approved') {
                console.log('ℹ️ Pagamento já foi processado anteriormente');
                res.status(200).json({ status: 'already_processed' });
                return;
            }
        }
        
        res.status(200).json({ status: 'received' });
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// --- VERIFICAR STATUS DO PAGAMENTO (MANTÉM COMPATIBILIDADE) ---
app.post('/api/verificar-pagamento', async (req, res) => {
    try {
        const { id_pagamento } = req.body;
        console.log('🔍 Verificando pagamento:', id_pagamento);
        
        let pagamento = await Pagamento.findOne({
            where: { transaction_id: id_pagamento.toString() }
        });
        
        if (!pagamento) {
            console.log('❌ Pagamento não encontrado:', id_pagamento);
            return res.json({ sucesso: false, erro: 'Pagamento não encontrado' });
        }
        
        console.log('💰 Status do pagamento:', pagamento.status);
        
        if (pagamento.status === 'approved' && pagamento.codigo_entregue) {
            console.log('✅ Pagamento aprovado, código:', pagamento.codigo_entregue);
            return res.json({
                sucesso: true,
                status: 'approved',
                codigo: pagamento.codigo_entregue,
                nome: pagamento.nome,
                plano: pagamento.plano
            });
        }
        
        // Verificar status na BuckPay se ainda pending
        if (pagamento.status === 'pending') {
            try {
                console.log('🔄 Verificando status na BuckPay - external_id:', pagamento.external_id);
                const response = await buckpayClient.get(`/v1/transactions/external_id/${pagamento.external_id}`);
                const transactionData = response.data.data;
                
                console.log('📡 Status BuckPay:', transactionData.status);
                
                if (transactionData.status === 'paid') {
                    console.log('🎯 Status mudou para paid - processando entrega...');
                    
                    const t = await sequelize.transaction();
                    try {
                        const codigo = await Codigo.findOne({ 
                            where: { status: 'disponivel' },
                            transaction: t
                        });

                        if (codigo) {
                            await codigo.update({
                                status: 'vendido',
                                transaction_id: id_pagamento.toString()
                            }, { transaction: t });
                            
                            await pagamento.update({
                                status: 'approved',
                                codigo_entregue: codigo.codigo
                            }, { transaction: t });

                            await t.commit();
                            
                            console.log('✅ Código entregue via verificação:', codigo.codigo);
                            
                            // Enviar WhatsApp se disponível
                            if (pagamento.whatsapp && whatsappEnabled) {
                                setImmediate(async () => {
                                    await enviarWhatsAppCodigo(
                                        pagamento.nome,
                                        pagamento.whatsapp,
                                        codigo.codigo,
                                        pagamento.plano
                                    );
                                });
                            }
                            
                            return res.json({
                                sucesso: true,
                                status: 'approved',
                                codigo: codigo.codigo,
                                nome: pagamento.nome,
                                plano: pagamento.plano
                            });
                        } else {
                            await t.rollback();
                            console.error('❌ Sem códigos disponíveis');
                            return res.json({ sucesso: true, status: 'no_stock' });
                        }
                    } catch (error) {
                        await t.rollback();
                        throw error;
                    }
                }
            } catch (buckpayError) {
                console.error('⚠️ Erro ao consultar BuckPay:', buckpayError.response?.data || buckpayError.message);
            }
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
        const listaCodigos = codigos.split('\n').map(l => l.trim()).filter(Boolean);
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
            total: pagamentos.length,
            pagamentos: pagamentos,
            payment_provider: 'BuckPay'
        });
    } catch (error) {
        console.error("Erro ao buscar pagamentos:", error);
        res.status(500).json({ erro: "Erro interno" });
    }
});

app.get('/resetar-codigos', async (req, res) => {
    try {
        const t = await sequelize.transaction();
        
        try {
            const [updatedCodigosCount] = await Codigo.update(
                { status: 'disponivel', transaction_id: null },
                { where: { status: 'vendido' }, transaction: t }
            );

            const deletedPagamentosCount = await Pagamento.destroy({
                where: {},
                truncate: true,
                transaction: t
            });

            await t.commit();

            const mensagem = `♻️ Reset concluído com sucesso!\n\n- ${updatedCodigosCount} códigos foram marcados como 'disponível'.\n- Todos os registros de pagamento foram apagados.`;
            
            console.log(mensagem);
            res.status(200).send(mensagem);
        } catch (error) {
            await t.rollback();
            throw error;
        }
    } catch (error) {
        console.error("❌ Erro ao resetar os dados:", error);
        res.status(500).send("❌ Erro interno do servidor ao tentar resetar os dados.");
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
    console.log(`📍 Rotas de monitoramento:`);
    console.log(`   - Ping: https://unitv.onrender.com/ping`);
    console.log(`   - Health: https://unitv.onrender.com/health`);
    console.log(`   - Status: https://unitv.onrender.com/admin/status`);
    console.log(`📍 Webhook fixo: https://unitv.onrender.com/webhook`);
    console.log(`📱 WhatsApp API: https://unitv.onrender.com/api/whatsapp/status`);
    console.log(`💳 Provider de pagamento: BuckPay`);
    
    try {
        await sequelize.authenticate();
        console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
        
        await executarMigracoes();
        await sequelize.sync({ alter: false });
        console.log('✅ Tabelas sincronizadas.');
        
        // === INICIALIZAR WHATSAPP ===
        if (whatsappEnabled) {
            console.log('📱 Inicializando WhatsApp...');
            setTimeout(async () => {
                try {
                    await whatsappClient.initialize();
                    console.log('✅ WhatsApp Client inicializado');
                } catch (error) {
                    console.error('❌ Erro ao inicializar WhatsApp:', error);
                    whatsappEnabled = false;
                }
            }, 2000); // Aguardar 2s após o servidor iniciar
        } else {
            console.log('📱 WhatsApp desabilitado via variável de ambiente');
        }
        
    } catch (error) {
        console.error('❌ Não foi possível conectar ao banco de dados:', error);
    }
});
