# Usa uma imagem oficial do PHP com o servidor Apache
FROM php:8.2-apache

# Copia todos os ficheiros da sua pasta 'frontend' para a pasta pública do servidor dentro do container
COPY frontend/ /var/www/html/

# Habilita módulos úteis do Apache
RUN a2enmod rewrite

# Define o diretório de trabalho para os próximos comandos
WORKDIR /var/www/html

# Instala as ferramentas necessárias (git, unzip) e o Composer (gestor de pacotes do PHP)
RUN apt-get update && apt-get install -y unzip git && \
    curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Instala as dependências do seu projeto (a biblioteca do Mercado Pago)
RUN composer install
