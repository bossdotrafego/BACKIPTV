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
// Tabela de códigos (já existe)
const Codigo = sequelize.define('Codigo', {
  codigo: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'disponivel'
  },
  id_pagamento_mp: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {});

// Nova tabela para controlar pagamentos
const Pagamento = sequelize.define('Pagamento', {
  id_pagamento_mp: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  nome: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false
  },
  plano: {
    type: DataTypes.STRING,
    allowNull: false
  },
  valor: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pending' // pending, approved, cancelled
  },
  codigo_entregue: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {});

const app = express();
app.use(cors());
app.use(express.json());

// --- SERVIR ARQUIVOS ESTÁTICOS ---
app.use(express.static('.'));

// --- CONFIGURAÇÃO DO MERCADO PAGO ---
const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_TOKEN });

// --- ROTA: GERAR PAGAMENTO (sua rota original + salvar no banco) ---
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
            notification_url: `${process.env.WEBHOOK_URL || 'https://unitv.onrender.com'}/webhook`,
        };

        const result = await payment.create({ body });

        // Salvar pagamento no banco
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

// --- WEBHOOK DO MERCADO PAGO (NOVO) ---
app.post('/webhook', async (req, res) => {
    try {
        console.log('📩 Webhook recebido:', req.body);
        
        const { type, data } = req.body;
        
        if (type === 'payment') {
            const paymentId = data.id;
            
            // Buscar detalhes do pagamento no MP
            const payment = new Payment(client);
            const paymentData = await payment.get({ id: paymentId });
            
            console.log('💰 Status do pagamento:', paymentData.status);
            
            if (paymentData.status === 'approved') {
                // Buscar pagamento no nosso banco
                const pagamento = await Pagamento.findOne({
                    where: { id_pagamento_mp: paymentId.toString() }
                });
                
                if (pagamento && pagamento.status === 'pending') {
                    // Pegar um código disponível
                    const codigo = await Codigo.findOne({
                        where: { status: 'disponivel' }
                    });
                    
                    if (codigo) {
                        // Marcar código como vendido
                        await codigo.update({
                            status: 'vendido',
                            id_pagamento_mp: paymentId.toString()
                        });
                        
                        // Atualizar pagamento
                        await pagamento.update({
                            status: 'approved',
                            codigo_entregue: codigo.codigo
                        });
                        
                        console.log('✅ Código entregue:', codigo.codigo, 'para:', pagamento.email);
                    } else {
                        console.error('❌ Nenhum código disponível!');
                    }
                }
            }
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(500).send('Erro');
    }
});

// --- VERIFICAR STATUS DO PAGAMENTO (NOVO) ---
app.post('/api/verificar-pagamento', async (req, res) => {
    try {
        const { id_pagamento } = req.body;
        
        const pagamento = await Pagamento.findOne({
            where: { id_pagamento_mp: id_pagamento.toString() }
        });
        
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
        
        return res.json({
            sucesso: true,
            status: pagamento.status
        });
        
    } catch (error) {
        console.error('Erro ao verificar pagamento:', error);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
});

// --- ADMIN: PÁGINA PRINCIPAL (sua rota original) ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_adicionar.html'));
});

// --- PÁGINA DE OBRIGADO ---
app.get('/obrigado.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'obrigado.html'));
});

// --- ADMIN: ADICIONAR CÓDIGOS (sua rota original) ---
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

// --- ADMIN: STATUS DOS CÓDIGOS (NOVO - OPCIONAL) ---
app.get('/admin/status', async (req, res) => {
    try {
        const stats = await sequelize.query(`
            SELECT 
                status,
                COUNT(*) as quantidade
            FROM "Codigos" 
            GROUP BY status
        `, { type: Sequelize.QueryTypes.SELECT });
        
        const pagamentos = await Pagamento.count({
            where: { status: 'approved' }
        });
        
        res.json({
            codigos: stats,
            pagamentos_aprovados: pagamentos
        });
    } catch (error) {
        console.error("Erro ao buscar status:", error);
        res.status(500).json({ erro: "Erro interno" });
    }
});

// --- INICIAR SERVIDOR (seu código original) ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    try {
        await sequelize.authenticate();
        console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
        await sequelize.sync({ alter: true });
        console.log('✅ Tabelas sincronizadas.');
    } catch (error) {
        console.error('❌ Não foi possível conectar ao banco de dados:', error);
    }
});
