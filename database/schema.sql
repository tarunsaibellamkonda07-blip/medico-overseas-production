CREATE DATABASE IF NOT EXISTS medico_overseas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'medico_user'@'%' IDENTIFIED BY 'change-this-database-password';
GRANT ALL PRIVILEGES ON medico_overseas.* TO 'medico_user'@'%';
FLUSH PRIVILEGES;
