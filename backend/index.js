require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
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
    // Suporte para ambas as colunas durante migração
    id_pagamento_mp: {
        type: DataTypes.STRING,
        allowNull: true
    },
    transaction_id: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {});

const Pagamento = sequelize.define('Pagamento', {
    // Suporte para ambas as colunas durante migração
    id_pagamento_mp: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    transaction_id: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    external_id: {
        type: DataTypes.STRING,
        allowNull: true // Temporário para migração
    },
    nome: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    plano: { type: DataTypes.STRING, allowNull: false },
    valor: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending, approved, cancelled
    codigo_entregue: { type: DataTypes.STRING, allowNull: true }
}, {});

// --- FUNÇÃO DE MIGRAÇÃO AUTOMÁTICA ---
async function executarMigracoes() {
    const queryInterface = sequelize.getQueryInterface();
    
    try {
        console.log('🔄 Iniciando migrações automáticas...');
        
        // 1. Verificar se coluna transaction_id existe na tabela Codigos
        const codigosColumns = await queryInterface.describeTable('Codigos');
        
        if (!codigosColumns.transaction_id && codigosColumns.id_pagamento_mp) {
            console.log('📝 Migração 1: Renomeando id_pagamento_mp → transaction_id na tabela Codigos');
            
            // Adicionar nova coluna
            await queryInterface.addColumn('Codigos', 'transaction_id', {
                type: DataTypes.STRING,
                allowNull: true
            });
            
            // Copiar dados da coluna antiga para nova
            await sequelize.query('UPDATE "Codigos" SET transaction_id = id_pagamento_mp WHERE id_pagamento_mp IS NOT NULL');
            
            // Remover coluna antiga
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
            
            // Adicionar nova coluna
            await queryInterface.addColumn('Pagamentos', 'transaction_id', {
                type: DataTypes.STRING,
                allowNull: true,
                unique: true
            });
            
            // Copiar dados da coluna antiga para nova
            await sequelize.query('UPDATE "Pagamentos" SET transaction_id = id_pagamento_mp WHERE id_pagamento_mp IS NOT NULL');
            
            // Remover coluna antiga
            await queryInterface.removeColumn('Pagamentos', 'id_pagamento_mp');
            
            console.log('✅ Migração 3 concluída: Pagamentos.transaction_id');
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
app.use(express.static('.'));

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

// ===================================================================
//                    ROTA DE PING PARA UPTIME MONITORING
// ===================================================================

// --- ROTA DE PING OTIMIZADA ---
app.get('/ping', (req, res) => {
    res.status(200).json({ 
        status: 'online',
        service: 'UniTV Backend - BuckPay',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '2.0.0',
        payment_provider: 'BuckPay'
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
//                    ROTAS DE PAGAMENTO
// ===================================================================

// --- FUNÇÃO AUXILIAR: GERAR EXTERNAL_ID ÚNICO ---
function gerarExternalId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `unitv_${timestamp}_${random}`;
}

// --- ROTA: GERAR PAGAMENTO ---
app.post('/api/gerar-pagamento', async (req, res) => {
    try {
        const { nome, email, plano, valor } = req.body;
        if (!nome || !email || !plano || !valor) {
            return res.status(400).json({ erro: "Dados incompletos." });
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
                email: email
            }
        };

        console.log('🔥 Criando transação BuckPay:', {
            external_id: externalId,
            valor: valor,
            valor_centavos: valorCentavos,
            email: email
        });

        const response = await buckpayClient.post('/v1/transactions', buckpayBody);
        const transaction = response.data.data;

        console.log('✅ Transação BuckPay criada:', {
            id: transaction.id,
            external_id: externalId,
            status: transaction.status
        });

        // Salvar no banco de dados
        await Pagamento.create({
            transaction_id: transaction.id,
            external_id: externalId,
            nome,
            email,
            plano,
            valor: Number(valor),
            status: 'pending'
        });

        res.json({
            sucesso: true,
            id_pagamento: transaction.id, // Mantém compatibilidade com frontend
            qr_code_base64: transaction.pix.qrcode_base64,
            qr_code: transaction.pix.code
        });

    } catch (error) {
        console.error("ERRO DETALHADO DA BUCKPAY:", error.response?.data || error.message);
        return res.status(500).json({ erro: "Erro ao gerar cobrança PIX." });
    }
});

// --- WEBHOOK DA BUCKPAY MELHORADO ---
app.post('/webhook', async (req, res) => {
    try {
        console.log('📩 Webhook BuckPay recebido:', JSON.stringify(req.body, null, 2));
        console.log('📍 Headers:', JSON.stringify(req.headers, null, 2));
        
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
                            transaction_id: transactionId
                        }, { transaction: t });
                        
                        // Atualizar pagamento no nosso banco
                        await pagamentoLocal.update({
                            status: 'approved', // Mantém compatibilidade
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
                        console.error('❌ CRÍTICO: Pagamento aprovado sem códigos disponíveis em estoque! ID da Transação:', transactionId);
                        console.error('📧 Cliente afetado:', pagamentoLocal.email);
                        
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
        } else if (event === 'transaction.created') {
            console.log('📩 Transação criada (pending) - ignorando');
        } else {
            console.log('📩 Evento não processado:', event, '- Status:', data?.status);
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
        
        // Procurar por transaction_id OU id_pagamento_mp (compatibilidade)
        let pagamento = await Pagamento.findOne({
            where: { transaction_id: id_pagamento.toString() }
        });
        
        // Se não encontrar por transaction_id, tentar por id_pagamento_mp (dados antigos)
        if (!pagamento) {
            pagamento = await Pagamento.findOne({
                where: { id_pagamento_mp: id_pagamento.toString() }
            });
        }

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
        
        // Se ainda estiver pending, verificar status na BuckPay
        if (pagamento.status === 'pending') {
            try {
                console.log('🔄 Verificando status na BuckPay - external_id:', pagamento.external_id);
                const response = await buckpayClient.get(`/v1/transactions/external_id/${pagamento.external_id}`);
                const transactionData = response.data.data;
                
                console.log('📡 Status BuckPay:', transactionData.status);
                
                if (transactionData.status === 'paid') {
                    // Atualizar status local e processar como webhook
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
                // Continua com status local em caso de erro na API
            }
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
            payment_provider: 'BuckPay',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Erro ao buscar status:", error);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// --- ADMIN: LISTAR TODOS OS PAGAMENTOS ---
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

// --- ROTA: RESETAR CÓDIGOS E PAGAMENTOS ---
app.get('/resetar-codigos', async (req, res) => {
    try {
        const t = await sequelize.transaction();
        
        try {
            // Resetar códigos vendidos para disponíveis
            const [updatedCodigosCount] = await Codigo.update(
                { status: 'disponivel', transaction_id: null },
                { where: { status: 'vendido' }, transaction: t }
            );

            // Deletar todos os pagamentos
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
    console.log(`🚀 Servidor UniTV-BuckPay rodando na porta ${PORT}`);
    console.log(`📍 Rotas de monitoramento:`);
    console.log(`   - Ping: https://unitv.onrender.com/ping`);
    console.log(`   - Health: https://unitv.onrender.com/health`);
    console.log(`   - Status: https://unitv.onrender.com/admin/status`);
    console.log(`📍 Webhook fixo: https://unitv.onrender.com/webhook`);
    console.log(`💳 Provider de pagamento: BuckPay`);
    
    try {
        await sequelize.authenticate();
        console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
        
        // Executar migrações antes de sincronizar
        await executarMigracoes();
        
        await sequelize.sync({ alter: false }); // Não alterar após migrações manuais
        console.log('✅ Tabelas sincronizadas.');
    } catch (error) {
        console.error('❌ Não foi possível conectar ao banco de dados:', error);
    }
});
