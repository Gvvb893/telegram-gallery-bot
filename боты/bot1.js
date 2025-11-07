const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const path = require('path');

// Подключаем ключ Firebase
const serviceAccount = require(path.join(__dirname, 'firebase-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://photo-gallery-a9057-default-rtdb.firebaseio.com/'
});

const db = admin.database();

// 🔒 Только ты можешь использовать этого бота
const ADMIN_ID = 783845123; // <-- замени на свой Telegram ID
const TOKEN = '8296808793:AAFw35peSYik7QXjbzI7sQpp3nQ-2gr50u8'; // <-- вставь токен от BotFather

const bot = new TelegramBot(TOKEN, { polling: true });

// Главное меню
const menu = {
  reply_markup: {
    keyboard: [
      ['📸 Добавить ссылку на фотогалерею'],
      ['🏠 Добавить заведение'],
      ['📋 Список заведений'],
      ['❌ Удалить заведение']
    ],
    resize_keyboard: true
  }
};

// Проверка доступа
function isAdmin(chatId) {
  if (chatId !== ADMIN_ID) {
    bot.sendMessage(chatId, '⛔ У вас нет доступа.');
    return false;
  }
  return true;
}

// === Старт ===
bot.onText(/\/start/, (msg) => {
  if (isAdmin(msg.chat.id)) {
    bot.sendMessage(msg.chat.id, 'Привет! Это админ-бот фотогалереи 📷', menu);
  }
});

// === Добавление заведения ===
bot.onText(/🏠 Добавить заведение/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;

  bot.sendMessage(msg.chat.id, '🆔 Введи ID заведения (латиницей, без пробелов):');
  bot.once('message', async (idMsg) => {
    const venueId = idMsg.text.trim();
    
    // Проверяем, существует ли уже заведение с таким ID
    const existingVenue = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    if (existingVenue.exists()) {
      bot.sendMessage(msg.chat.id, '❌ Заведение с таким ID уже существует!');
      return;
    }
    
    bot.sendMessage(msg.chat.id, '📛 Введи название заведения:');
    bot.once('message', async (nameMsg) => {
      const name = nameMsg.text.trim();
      bot.sendMessage(msg.chat.id, '🖼 Введи ссылку на изображение:');
      bot.once('message', async (imageMsg) => {
        const image = imageMsg.text.trim();

        const ref = db.ref(`photoGalleryData/venues/${venueId}`);
        await ref.set({ name, image });
        await db.ref(`photoGalleryData/photos/${venueId}`).set({});

        bot.sendMessage(msg.chat.id, `✅ Заведение "${name}" добавлено!`, menu);
      });
    });
  });
});

// === Добавление фото (с выбором заведения) ===
bot.onText(/📸 Добавить ссылку на фотогалерею/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;

  const snapshot = await db.ref('photoGalleryData/venues').once('value');
  const venues = snapshot.val();

  if (!venues) {
    bot.sendMessage(msg.chat.id, '❗ Нет заведений. Добавь сначала хотя бы одно.', menu);
    return;
  }

  // создаем кнопки для выбора заведения
  const buttons = Object.entries(venues).map(([id, venue]) => {
    return [{ text: venue.name, callback_data: `addphoto_${id}` }];
  });

  // Добавляем кнопку "Назад"
  buttons.push([{ text: "🔙 Назад", callback_data: "main_menu" }]);

  bot.sendMessage(msg.chat.id, 'Выбери заведение для добавления фото:', {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
});

// === Обработка кнопок ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  if (!isAdmin(chatId)) return;

  const data = query.data;

  // --- 1. Добавление фото к заведению ---
  if (data.startsWith('addphoto_')) {
    const venueId = data.replace('addphoto_', '');
    const venueSnapshot = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    const venue = venueSnapshot.val();

    if (!venue) {
      bot.sendMessage(chatId, '❌ Ошибка: заведение не найдено.');
      return;
    }

    bot.sendMessage(chatId, `📸 Добавляем фото для "${venue.name}". Выберите дату:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📅 Сегодня", callback_data: `date_today_${venueId}` },
            { text: "🗓 Другая дата", callback_data: `date_custom_${venueId}` }
          ],
          [{ text: "🔙 Назад", callback_data: "back_to_venues" }]
        ]
      }
    });
  }

  // --- 2. Кнопка "Сегодня" ---
  else if (data.startsWith('date_today_')) {
    const venueId = data.replace('date_today_', '');
    const venueSnapshot = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    const venue = venueSnapshot.val();

    if (!venue) return bot.sendMessage(chatId, '❌ Ошибка: заведение не найдено.');

    // Московская дата
    const moscowTime = new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" });
    const date = new Date(moscowTime).toISOString().split('T')[0];

    bot.sendMessage(chatId, `📅 Дата: *${date}*\n📎 Отправьте ссылку на фото:`, { parse_mode: "Markdown" });

    // Ловим следующее сообщение со ссылкой
    bot.once('message', async (msg) => {
      const url = msg.text.trim();

      await db.ref(`photoGalleryData/photos/${venueId}/${date}`).set(url);

      bot.sendMessage(
        chatId,
        `✅ Ссылка добавлена для заведения *"${venue.name}"*\n📅 ${date}\n🔗 ${url}`,
        { parse_mode: "Markdown" }
      );

      showMainMenu(chatId); // Возврат в главное меню
    });
  }

  // --- 3. Кнопка "Другая дата" ---
  else if (data.startsWith('date_custom_')) {
    const venueId = data.replace('date_custom_', '');
    const venueSnapshot = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    const venue = venueSnapshot.val();

    if (!venue) return bot.sendMessage(chatId, '❌ Ошибка: заведение не найдено.');

    bot.sendMessage(chatId, `🗓 Введите дату для "${venue.name}" (в формате YYYY-MM-DD):`);

    bot.once('message', async (dateMsg) => {
      const date = dateMsg.text.trim();
      
      // Простая валидация даты
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        bot.sendMessage(chatId, '❌ Неверный формат даты! Используйте YYYY-MM-DD');
        return;
      }
      
      bot.sendMessage(chatId, '📎 Отправьте ссылку на фото:');

      bot.once('message', async (urlMsg) => {
        const url = urlMsg.text.trim();

        await db.ref(`photoGalleryData/photos/${venueId}/${date}`).set(url);

        bot.sendMessage(
          chatId,
          `✅ Ссылка добавлена для заведения *"${venue.name}"*\n📅 ${date}\n🔗 ${url}`,
          { parse_mode: "Markdown" }
        );

        showMainMenu(chatId); // Возврат в главное меню
      });
    });
  }

  // --- 4. Главное меню ---
  else if (data === "main_menu") {
    showMainMenu(chatId);
  }

  // --- 5. Назад к списку заведений ---
  else if (data === "back_to_venues") {
    const snapshot = await db.ref('photoGalleryData/venues').once('value');
    const venues = snapshot.val();

    if (!venues) {
      bot.sendMessage(chatId, '❗ Нет заведений.', menu);
      return;
    }

    const buttons = Object.entries(venues).map(([id, venue]) => {
      return [{ text: venue.name, callback_data: `addphoto_${id}` }];
    });

    buttons.push([{ text: "🔙 Назад", callback_data: "main_menu" }]);

    bot.sendMessage(chatId, 'Выбери заведение для добавления фото:', {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  }
});

// === Главное меню ===
function showMainMenu(chatId) {
  bot.sendMessage(chatId, 'Главное меню:', menu);
}

// === Список заведений ===
bot.onText(/📋 Список заведений/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;

  const snapshot = await db.ref('photoGalleryData/venues').once('value');
  const data = snapshot.val();

  if (!data) {
    bot.sendMessage(msg.chat.id, '📭 Заведения не найдены.', menu);
    return;
  }

  let text = '📋 Список заведений:\n\n';
  for (const [id, venue] of Object.entries(data)) {
    text += `🏠 ${venue.name}\n🆔 ${id}\n🖼 ${venue.image}\n\n`;
  }

  bot.sendMessage(msg.chat.id, text, menu);
});

// === Удаление заведения ===
bot.onText(/❌ Удалить заведение/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;

  const snapshot = await db.ref('photoGalleryData/venues').once('value');
  const venues = snapshot.val();

  if (!venues) {
    bot.sendMessage(msg.chat.id, '📭 Нет заведений для удаления.', menu);
    return;
  }

  // Создаем кнопки для выбора заведения для удаления
  const buttons = Object.entries(venues).map(([id, venue]) => {
    return [{ text: `${venue.name} (${id})`, callback_data: `delete_${id}` }];
  });

  buttons.push([{ text: "🔙 Отмена", callback_data: "main_menu" }]);

  bot.sendMessage(msg.chat.id, 'Выбери заведение для удаления:', {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
});

// === Обработка удаления заведения ===
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  if (!isAdmin(chatId)) return;

  const data = query.data;

  if (data.startsWith('delete_')) {
    const venueId = data.replace('delete_', '');
    const venueSnapshot = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    const venue = venueSnapshot.val();

    if (!venue) {
      bot.sendMessage(chatId, '❌ Заведение не найдено.');
      return;
    }

    await db.ref(`photoGalleryData/venues/${venueId}`).remove();
    await db.ref(`photoGalleryData/photos/${venueId}`).remove();
    
    bot.sendMessage(chatId, `🗑 Заведение "${venue.name}" (${venueId}) удалено.`, menu);
  }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
  console.log('Polling error:', error);
});

console.log('🤖 Бот запущен и готов к работе!');