require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { Sequelize, DataTypes } = require('sequelize');

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

// --- MODELOS DO BANCO ---
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
    id_pagamento_mp: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {});

const Pagamento = sequelize.define('Pagamento', {
    id_pagamento_mp: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    nome: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    plano: { type: DataTypes.STRING, allowNull: false },
    valor: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending, approved, cancelled
    codigo_entregue: { type: DataTypes.STRING, allowNull: true }
}, {});

const app = express();
app.use(cors());
app.use(express.json());

// --- SERVIR ARQUIVOS ESTÁTICOS ---
app.use(express.static('.'));

// --- CONFIGURAÇÃO DO MERCADO PAGO ---
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_TOKEN });

// ===================================================================
//                    ROTA DE PING PARA UPTIME MONITORING
// ===================================================================

// --- ROTA DE PING OTIMIZADA ---
app.get('/ping', (req, res) => {
    res.status(200).json({ 
        status: 'online',
        service: 'UniTV Backend',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.0.0'
    });
});

// --- ROTA DE HEALTH CHECK ---
app.get('/health', async (req, res) => {
    try {
        // Testa conexão com banco
        await sequelize.authenticate();
        
        // Conta códigos disponíveis
        const codigosDisponiveis = await Codigo.count({ where: { status: 'disponivel' } });
        
        res.status(200).json({
            status: 'healthy',
            database: 'connected',
            codigosDisponiveis,
            timestamp: new Date().toISOString()
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
//                    ROTAS DE PAGAMENTO
// ===================================================================

// --- ROTA: GERAR PAGAMENTO ---
app.post('/api/gerar-pagamento', async (req, res) => {
    try {
        const { nome, email, plano, valor } = req.body;
        if (!nome || !email || !plano || !valor) {
            return res.status(400).json({ erro: "Dados incompletos." });
        }

        const payment = new Payment(client);
        const body = {
            transaction_amount: Number(valor),
            description: `Recarga UniTV - ${plano}`,
            payment_method_id: 'pix',
            payer: { email: email, first_name: nome },
            // WEBHOOK CORRIGIDO - SEMPRE FIXO PARA EVITAR PROBLEMAS
            notification_url: 'https://unitv.onrender.com/webhook',
        };

        const result = await payment.create({ body });

        // Log para debug
        console.log('🔥 Pagamento criado:', {
            id: result.id,
            valor: valor,
            email: email,
            webhook: 'https://unitv.onrender.com/webhook'
        });

        await Pagamento.create({
            id_pagamento_mp: result.id.toString(),
            nome,
            email,
            plano,
            valor: Number(valor),
            status: 'pending'
        });

        res.json({
            sucesso: true,
            id_pagamento: result.id,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
            qr_code: result.point_of_interaction.transaction_data.qr_code
        });
    } catch (error) {
        console.error("ERRO DETALHADO DO MERCADO PAGO:", error.cause || error.message);
        return res.status(500).json({ erro: "Erro ao gerar cobrança PIX." });
    }
});

// --- WEBHOOK DO MERCADO PAGO MELHORADO ---
app.post('/webhook', async (req, res) => {
    try {
        console.log('📩 Webhook recebido:', JSON.stringify(req.body, null, 2));
        console.log('📍 Headers:', JSON.stringify(req.headers, null, 2));
        
        const { type, data } = req.body;

        if (type === 'payment') {
            const paymentId = data.id;
            console.log('💳 Processando pagamento ID:', paymentId);
            
            const payment = new Payment(client);
            const paymentData = await payment.get({ id: paymentId });

            console.log('💰 Status do pagamento:', paymentData.status);
            console.log('💰 Dados completos:', JSON.stringify(paymentData, null, 2));

            if (paymentData.status === 'approved') {
                const pagamentoLocal = await Pagamento.findOne({
                    where: { id_pagamento_mp: paymentId.toString() }
                });

                console.log('🔍 Pagamento local encontrado:', pagamentoLocal ? 'SIM' : 'NÃO');

                if (pagamentoLocal && pagamentoLocal.status === 'pending') {
                    console.log('🔄 Iniciando entrega do código...');
                    
                    // Usar transaction para garantir atomicidade
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
                                id_pagamento_mp: paymentId.toString()
                            }, { transaction: t });
                            
                            // Atualizar pagamento no nosso banco
                            await pagamentoLocal.update({
                                status: 'approved',
                                codigo_entregue: codigo.codigo
                            }, { transaction: t });

                            await t.commit();
                            
                            console.log('✅ SUCESSO! Código entregue:', codigo.codigo, 'para:', pagamentoLocal.email);
                            console.log('📧 Cliente:', pagamentoLocal.nome, '- Plano:', pagamentoLocal.plano);
                            
                            // Resposta de sucesso
                            res.status(200).json({ 
                                status: 'success', 
                                codigo_entregue: codigo.codigo,
                                cliente: pagamentoLocal.email
                            });
                            return;
                        } else {
                            await t.rollback();
                            console.error('❌ CRÍTICO: Pagamento aprovado sem códigos disponíveis em estoque! ID do Pagamento:', paymentId);
                            console.error('📧 Cliente afetado:', pagamentoLocal.email);
                            
                            // TODO: Enviar email de alerta para admin
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
                } else {
                    console.log('⚠️ Pagamento local não encontrado ou status inválido');
                }
            } else {
                console.log('💰 Pagamento não aprovado. Status:', paymentData.status);
            }
        } else {
            console.log('📩 Webhook não é de pagamento. Type:', type);
        }
        
        res.status(200).json({ status: 'received' });
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// --- VERIFICAR STATUS DO PAGAMENTO ---
app.post('/api/verificar-pagamento', async (req, res) => {
    try {
        const { id_pagamento } = req.body;
        console.log('🔍 Verificando pagamento:', id_pagamento);
        
        const pagamento = await Pagamento.findOne({
            where: { id_pagamento_mp: id_pagamento.toString() }
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
        
        return res.json({ sucesso: true, status: pagamento.status });
    } catch (error) {
        console.error('Erro ao verificar pagamento:', error);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
});

// ===================================================================
//                    ROTAS DE ADMINISTRAÇÃO
// ===================================================================

// --- ADMIN: PÁGINA PRINCIPAL ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_adicionar.html'));
});

// --- PÁGINA DE OBRIGADO ---
app.get('/obrigado.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'obrigado.html'));
});

// --- ADMIN: ADICIONAR CÓDIGOS ---
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

// --- ADMIN: STATUS DOS CÓDIGOS ---
app.get('/admin/status', async (req, res) => {
    try {
        const stats = await sequelize.query(
            `SELECT status, COUNT(*) as quantidade FROM "Codigos" GROUP BY status`, 
            { type: Sequelize.QueryTypes.SELECT }
        );
        const pagamentos = await Pagamento.count({ where: { status: 'approved' } });
        
        res.json({
            codigos: stats,
            pagamentos_aprovados: pagamentos,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Erro ao buscar status:", error);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// --- ADMIN: LISTAR TODOS OS PAGAMENTOS (NOVA ROTA PARA DEBUG) ---
app.get('/admin/pagamentos', async (req, res) => {
    try {
        const pagamentos = await Pagamento.findAll({
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        
        res.json({
            total: pagamentos.length,
            pagamentos: pagamentos
        });
    } catch (error) {
        console.error("Erro ao buscar pagamentos:", error);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// --- ROTA NOVA: RESETAR CÓDIGOS E PAGAMENTOS ---
app.get('/resetar-codigos', async (req, res) => {
    // TODO: Adicionar proteção por senha
    try {
        const t = await sequelize.transaction();
        
        try {
            // Passo 1: Reseta todos os códigos com status 'vendido' para 'disponivel'
            const [updatedCodigosCount] = await Codigo.update(
                { status: 'disponivel', id_pagamento_mp: null },
                { where: { status: 'vendido' }, transaction: t }
            );

            // Passo 2: Deleta TODOS os registros da tabela de pagamentos
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

// --- MIDDLEWARE DE ERRO GLOBAL ---
app.use((err, req, res, next) => {
    console.error('❌ Erro não tratado:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
});

// --- MIDDLEWARE 404 ---
app.use((req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📍 Rotas de monitoramento:`);
    console.log(`   - Ping: https://unitv.onrender.com/ping`);
    console.log(`   - Health: https://unitv.onrender.com/health`);
    console.log(`   - Status: https://unitv.onrender.com/admin/status`);
    console.log(`📍 Webhook fixo: https://unitv.onrender.com/webhook`);
    
    try {
        await sequelize.authenticate();
        console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
        await sequelize.sync({ alter: true });
        console.log('✅ Tabelas sincronizadas.');
    } catch (error) {
        console.error('❌ Não foi possível conectar ao banco de dados:', error);
    }
});
