# VPS Audio Processor

Node.js сервис для обработки аудио после Google TTS в n8n workflow.

## Возможности

- Получение аудио файлов от Google TTS
- Микширование с эмбиент треком
- Возврат обработанного аудио в n8n workflow
- Поддержка base64 и multipart/form-data
- Автоматическая очистка временных файлов

## Установка на VPS

1. Клонируйте файлы на VPS:
```bash
mkdir audio-processor
cd audio-processor
# Скопируйте все файлы
```

2. Установите зависимости:
```bash
npm install
```

3. Установите FFmpeg:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install ffmpeg

# CentOS/RHEL
sudo yum install ffmpeg
```

4. Создайте папку для эмбиент трека:
```bash
mkdir assets
# Загрузите ambient.mp3 в папку assets/
```

5. Настройте окружение:
```bash
cp .env.example .env
# Отредактируйте .env если нужно
```

6. Запустите сервис:
```bash
# Для разработки
npm run dev

# Для продакшена
npm start

# Или с PM2
npm install -g pm2
pm2 start server.js --name audio-processor
pm2 startup
pm2 save
```

## API Endpoints

### POST /process-base64
Обрабатывает base64 аудио данные (рекомендуется для n8n)

**Request:**
```json
{
  "audioData": "base64_encoded_audio",
  "chatId": "123456",
  "userName": "user_name",
  "goal": "meditation_goal"
}
```

**Response:**
```json
{
  "success": true,
  "audioData": "base64_processed_audio",
  "duration": 45.5,
  "processed": true,
  "mixed": true,
  "chatId": "123456",
  "userName": "user_name",
  "goal": "meditation_goal"
}
```

### POST /process-audio
Обрабатывает аудио файл через multipart/form-data

### GET /health
Проверка состояния сервиса

## Интеграция с n8n

В n8n после Google TTS Request добавьте HTTP Request node:

**URL:** `http://your-vps-ip:3000/process-base64`
**Method:** POST
**Body:**
```json
{
  "audioData": "{{ $json.candidates[0].content.parts[0].inlineData.data }}",
  "chatId": "{{ $('Webhook').first().json.message.chat.id }}",
  "userName": "{{ $('Webhook').first().json.message.from.first_name }}",
  "goal": "{{ $('Generate Meditation Text').first().json.goal }}"
}
```

## Структура файлов

```
vps-audio-processor/
├── server.js          # Основной сервер
├── package.json       # Зависимости
├── .env.example       # Пример конфигурации
├── README.md          # Документация
├── assets/            # Эмбиент треки
│   └── ambient.mp3
├── temp/              # Временные файлы (создается автоматически)
└── output/            # Выходные файлы (создается автоматически)
```

## Мониторинг

Проверить статус:
```bash
curl http://your-vps-ip:3000/health
```

Логи PM2:
```bash
pm2 logs audio-processor
```
