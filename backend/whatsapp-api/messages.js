// whatsapp/messages.js
const moment = require('moment');
moment.locale('pt-br');

class MessageTemplates {
    static codigoEntrega(nome, codigo, plano) {
        return `🎉 *Olá ${nome}!*

✅ *Seu pagamento foi aprovado!*

🔑 *Seu código UniTV:*
\`${codigo}\`

📦 *Plano:* ${plano}

📱 *Como usar:*
1. Abra o app UniTV
2. Vá em "Perfil"
3. Clique em "Centro de Resgate"
4. Digite seu código
5. Pronto! Aproveite!

💬 *Precisa de ajuda?*
É só responder essa mensagem!

*Obrigado por escolher a UniTV!* 🚀`;
    }

    static renovacaoLembrete(nome, diasRestantes, plano) {
        return `🔔 *Oi ${nome}!*

⏰ *Seu UniTV vence em ${diasRestantes} dias*

📦 *Plano atual:* ${plano}

🎯 *Renove agora com 20% OFF!*
👆 É só responder "RENOVAR"

💎 *Não perca seus canais favoritos!*

Atendimento: wa.me/554591567288`;
    }

    static vencimentoUrgente(nome, plano) {
        return `🚨 *${nome}, seu UniTV vence HOJE!*

📦 *Plano:* ${plano}
⏰ *Status:* Expira em algumas horas

🔥 *ÚLTIMA CHANCE - 30% OFF!*
👆 Responda "URGENTE" agora

⚡ *Evite interrupção do serviço*

Atendimento: wa.me/554591567288`;
    }

    static boasVindas(nome) {
        return `👋 *Seja bem-vindo(a) ${nome}!*

🎉 *Obrigado por escolher a UniTV!*

💎 *Você agora tem acesso a:*
• +1000 canais HD
• Filmes e séries ilimitados  
• Suporte 24/7
• Sem travamentos

📱 *Precisa de ajuda?*
• Como instalar: wa.me/554591567288
• Suporte técnico: wa.me/554591567288

*Aproveite sua experiência UniTV!* 🚀`;
    }

    static suporteTecnico(nome) {
        return `🛠️ *Suporte UniTV - ${nome}*

Como posso te ajudar hoje?

🔧 *Problemas comuns:*
• Instalação do app
• Inserir código
• Canais não carregam
• Travamentos

📱 *Para atendimento rápido:*
Descreva seu problema que vou te ajudar!

*Estou aqui para resolver!* 💪`;
    }

    static promocaoEspecial(nome) {
        return `🔥 *${nome}, OFERTA ESPECIAL!*

🎯 *APENAS HOJE:*
• Plano Anual: ~~R$ 261,90~~ por *R$ 149,90*
• Economia de R$ 112,00!

⚡ *Benefícios:*
• 12 meses de acesso
• Mais de 1000 canais
• Suporte prioritário
• Atualizações grátis

⏰ *Válido até 23:59h*
👆 Responda "QUERO" para garantir

*Não perca essa chance!* 💰`;
    }

    static codigoProblema(nome, codigo) {
        return `⚠️ *${nome}, detectamos um problema!*

🔍 *Código:* ${codigo}
❌ *Status:* Erro na ativação

🛠️ *Vamos resolver agora:*
1. Verifique se digitou corretamente
2. Certifique-se que o app está atualizado
3. Feche e abra o app novamente

💬 *Ainda com problema?*
Responda esta mensagem que vou te ajudar pessoalmente!

*Sua satisfação é nossa prioridade!* 🚀`;
    }

    static feedback(nome) {
        return `⭐ *${nome}, como está sua experiência?*

💭 *Sua opinião é muito importante!*

📝 *Responda com uma nota de 1 a 10:*
• Qualidade dos canais
• Velocidade do carregamento  
• Atendimento recebido

🎁 *Clientes 5⭐ ganham desconto especial na renovação!*

*Obrigado por escolher a UniTV!* 💙`;
    }

    static pagamentoRecebido(nome, valor, plano) {
        return `💰 *Pagamento confirmado!*

👤 *Cliente:* ${nome}
💵 *Valor:* R$ ${valor}
📦 *Plano:* ${plano}
⏰ *Data:* ${moment().format('DD/MM/YYYY HH:mm')}

✅ *Processando seu código...*
Em instantes você receberá seu código de ativação!

*Obrigado pela confiança!* 🙏`;
    }
}

module.exports = MessageTemplates;