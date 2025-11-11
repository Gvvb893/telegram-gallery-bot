require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs');
const { format } = require('date-fns');

// Подключаем ключ Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

// Исправляем формат ключа (важно для Node.js и Firebase)
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://photo-gallery-a9057-default-rtdb.firebaseio.com/'
});


const db = admin.database();

// 🔒 Только ты можешь использовать этого бота
const ADMIN_ID = Number(process.env.ADMIN_ID);
const TOKEN = process.env.BOT_TOKEN;


const bot = new TelegramBot(TOKEN, { polling: true });

// Главное меню
const menu = {
  reply_markup: {
    keyboard: [
      ['📸 Добавить ссылку на фотогалерею'],
      ['🏠 Добавить заведение'],
      ['📋 Список заведений', '📂 Показать все галереи'],
      ['❌ Удалить заведение', '🗑 Удалить галерею'],
      ['💾 Получить бекап', '📋 Главное меню'] // Добавлена кнопка Главное меню
    ],
    resize_keyboard: true
  }
};

// Хранилище для подтверждений удаления
const deleteConfirmations = new Map();

// Проверка доступа
function isAdmin(chatId) {
  if (chatId !== ADMIN_ID) {
    bot.sendMessage(chatId, '⛔ У вас нет доступа.');
    return false;
  }
  return true;
}

// Функция для создания бекапа
async function createBackup() {
  try {
    console.log('🔄 Создание бекапа...');
    
    // Получаем все данные из базы
    const venuesSnapshot = await db.ref('photoGalleryData/venues').once('value');
    const photosSnapshot = await db.ref('photoGalleryData/photos').once('value');
    
    const backupData = {
      venues: venuesSnapshot.val() || {},
      photos: photosSnapshot.val() || {},
      backupCreated: new Date().toISOString(),
      backupCreatedMoscow: new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" })
    };
    
    // Создаем папку для бекапов, если ее нет
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }
    
    // Сохраняем бекап в файл
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `backup_${timestamp}.json`;
    const filePath = path.join(backupDir, filename);
    
    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf8');
    
    console.log(`✅ Бекап создан: ${filename}`);
    return filePath;
    
  } catch (error) {
    console.error('❌ Ошибка при создании бекапа:', error);
    throw error;
  }
}

// Функция для отправки бекапа
async function sendBackup(chatId) {
  try {
    const backupMessage = await bot.sendMessage(chatId, '🔄 Создаю бекап...');
    
    const backupPath = await createBackup();
    const timestamp = format(new Date(), 'dd.MM.yyyy HH:mm');
    
    // Отправляем файл
    await bot.sendDocument(chatId, backupPath, {
      caption: `💾 Бекап данных\n📅 Создан: ${timestamp} (МСК)`,
      filename: `backup_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.json`
    });
    
    // Удаляем сообщение "Создаю бекап"
    await bot.deleteMessage(chatId, backupMessage.message_id);
    
    // Удаляем файл после отправки (опционально)
    setTimeout(() => {
      try {
        fs.unlinkSync(backupPath);
      } catch (e) {
        console.log('Не удалось удалить файл бекапа:', e.message);
      }
    }, 5000);
    
  } catch (error) {
    console.error('❌ Ошибка при отправке бекапа:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка при создании бекапа');
  }
}

// Настраиваем автоматический бекап каждый день в 7:00 по Москве
cron.schedule('0 7 * * *', async () => {
  try {
    console.log('🕖 Запуск автоматического бекапа...');
    const backupPath = await createBackup();
    const timestamp = format(new Date(), 'dd.MM.yyyy HH:mm');
    
    // Отправляем бекап администратору
    await bot.sendDocument(ADMIN_ID, backupPath, {
      caption: `🤖 Автоматический бекап\n📅 Создан: ${timestamp} (МСК)`,
      filename: `auto_backup_${format(new Date(), 'yyyy-MM-dd')}.json`
    });
    
    console.log('✅ Автоматический бекап отправлен');
    
    // Удаляем файл после отправки
    setTimeout(() => {
      try {
        fs.unlinkSync(backupPath);
      } catch (e) {
        console.log('Не удалось удалить файл бекапа:', e.message);
      }
    }, 5000);
    
  } catch (error) {
    console.error('❌ Ошибка автоматического бекапа:', error);
    bot.sendMessage(ADMIN_ID, '❌ Произошла ошибка при автоматическом бекапе');
  }
}, {
  timezone: "Europe/Moscow"
});

console.log('⏰ Автоматический бекап настроен на ежедневное выполнение в 7:00 по Москве');

// === Старт ===
bot.onText(/\/start/, (msg) => {
  if (isAdmin(msg.chat.id)) {
    bot.sendMessage(msg.chat.id, 'Привет! Это админ-бот фотогалереи 📷', menu);
  }
});

// === Главное меню ===
bot.onText(/📋 Главное меню/, (msg) => {
  if (isAdmin(msg.chat.id)) {
    showMainMenu(msg.chat.id);
  }
});

// === Получить бекап ===
bot.onText(/💾 Получить бекап/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  
  await sendBackup(msg.chat.id);
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

  // Добавляем кнопку "Главное меню"
  buttons.push([{ text: "📋 Главное меню", callback_data: "main_menu" }]);

  bot.sendMessage(msg.chat.id, 'Выбери заведение для добавления фото:', {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
});

// === Показать все галереи ===
bot.onText(/📂 Показать все галереи/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;

  try {
    // Получаем все заведения
    const venuesSnapshot = await db.ref('photoGalleryData/venues').once('value');
    const venues = venuesSnapshot.val();

    if (!venues) {
      bot.sendMessage(msg.chat.id, '📭 Нет заведений.', menu);
      return;
    }

    // Получаем все фотогалереи
    const photosSnapshot = await db.ref('photoGalleryData/photos').once('value');
    const allPhotos = photosSnapshot.val();

    let message = '📂 Все заведения и их галереи:\n\n';
    let hasGalleries = false;

    // Проходим по всем заведениям
    for (const [venueId, venue] of Object.entries(venues)) {
      message += `🏠 *${venue.name}*\n`;

      // Проверяем есть ли галереи для этого заведения
      if (allPhotos && allPhotos[venueId]) {
        const venuePhotos = allPhotos[venueId];
        
        // Проходим по всем датам галерей
        for (const [date, url] of Object.entries(venuePhotos)) {
          message += `   📅 ${date}: ${url}\n`;
          hasGalleries = true;
        }
      } else {
        message += `   📭 Нет добавленных галерей\n`;
      }
      message += '\n'; // Добавляем отступ между заведениями
    }

    if (!hasGalleries) {
      message = '📭 Нет добавленных галерей ни в одном заведении.';
    }

    // Отправляем сообщение с галереями
    bot.sendMessage(msg.chat.id, message, { 
      parse_mode: 'Markdown',
      reply_markup: menu.reply_markup 
    });

  } catch (error) {
    console.error('Ошибка при получении галерей:', error);
    bot.sendMessage(msg.chat.id, '❌ Произошла ошибка при получении данных.', menu);
  }
});

// === Удаление галереи ===
bot.onText(/🗑 Удалить галерею/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;

  const snapshot = await db.ref('photoGalleryData/venues').once('value');
  const venues = snapshot.val();

  if (!venues) {
    bot.sendMessage(msg.chat.id, '❗ Нет заведений.', menu);
    return;
  }

  // создаем кнопки для выбора заведения
  const buttons = Object.entries(venues).map(([id, venue]) => {
    return [{ text: venue.name, callback_data: `delete_gallery_${id}` }];
  });

  // Добавляем кнопку "Главное меню"
  buttons.push([{ text: "📋 Главное меню", callback_data: "main_menu" }]);

  bot.sendMessage(msg.chat.id, 'Выбери заведение для удаления галереи:', {
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
          [{ text: "🔙 Назад", callback_data: "back_to_venues" }],
          [{ text: "📋 Главное меню", callback_data: "main_menu" }]
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

      showMainMenu(chatId);
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
        return showMainMenu(chatId);
      }
      
      bot.sendMessage(chatId, '📎 Отправьте ссылку на фото:');

      // Обработчик для ввода ссылки
      bot.once('message', async (urlMsg) => {
        const url = urlMsg.text.trim();

        await db.ref(`photoGalleryData/photos/${venueId}/${date}`).set(url);

        bot.sendMessage(
          chatId,
          `✅ Ссылка добавлена для заведения *"${venue.name}"*\n📅 ${date}\n🔗 ${url}`,
          { parse_mode: "Markdown" }
        );

        showMainMenu(chatId);
      });
    });
  }

  // --- 4. Главное меню ---
  else if (data === "main_menu") {
    bot.sendMessage(chatId, 'Вы в главном меню, выберите дальнейшее действие:', menu);
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

    buttons.push([{ text: "📋 Главное меню", callback_data: "main_menu" }]);

    bot.sendMessage(chatId, 'Выбери заведение для добавления фото:', {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  }

  // --- 6. Первый этап удаления заведения ---
  else if (data.startsWith('delete_') && !data.startsWith('delete_gallery_')) {
    const venueId = data.replace('delete_', '');
    const venueSnapshot = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    const venue = venueSnapshot.val();

    if (!venue) {
      bot.sendMessage(chatId, '❌ Заведение не найдено.');
      return;
    }

    // Сохраняем информацию для подтверждения
    deleteConfirmations.set(chatId, {
      venueId: venueId,
      venueName: venue.name
    });

    bot.sendMessage(chatId, `❓ Вы точно хотите удалить заведение "${venue.name}"?`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Да", callback_data: `confirm_delete_${venueId}` },
            { text: "❌ Нет", callback_data: "main_menu" }
          ]
        ]
      }
    });
  }

  // --- 7. Второй этап удаления заведения ---
  else if (data.startsWith('confirm_delete_')) {
    const venueId = data.replace('confirm_delete_', '');
    const confirmation = deleteConfirmations.get(chatId);

    if (!confirmation || confirmation.venueId !== venueId) {
      bot.sendMessage(chatId, '❌ Ошибка подтверждения. Начните удаление заново.');
      deleteConfirmations.delete(chatId);
      return showMainMenu(chatId);
    }

    bot.sendMessage(chatId, `✍️ Для подтверждения удаления введите название заведения:\n"${confirmation.venueName}"`);

    // Ожидаем ввод названия заведения
    bot.once('message', async (nameMsg) => {
      const enteredName = nameMsg.text.trim();
      
      if (enteredName === confirmation.venueName) {
        // Название совпало - удаляем заведение
        await db.ref(`photoGalleryData/venues/${venueId}`).remove();
        await db.ref(`photoGalleryData/photos/${venueId}`).remove();
        
        bot.sendMessage(chatId, `✅ Заведение "${confirmation.venueName}" удалено!`, menu);
      } else {
        // Название не совпало
        bot.sendMessage(chatId, `❌ Название не совпало. Удаление отменено.`, menu);
      }
      
      // Очищаем подтверждение
      deleteConfirmations.delete(chatId);
    });
  }

  // --- 8. Выбор заведения для удаления галереи ---
  else if (data.startsWith('delete_gallery_')) {
    const venueId = data.replace('delete_gallery_', '');
    const venueSnapshot = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    const venue = venueSnapshot.val();

    if (!venue) {
      bot.sendMessage(chatId, '❌ Заведение не найдено.');
      return;
    }

    // Сохраняем информацию для удаления галереи
    deleteConfirmations.set(chatId, {
      venueId: venueId,
      venueName: venue.name,
      type: 'gallery'
    });

    bot.sendMessage(chatId, `🗑 Удаляем галерею для "${venue.name}". Выберите дату:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📅 Сегодня", callback_data: `delete_gallery_date_today_${venueId}` },
            { text: "🗓 Другая дата", callback_data: `delete_gallery_date_custom_${venueId}` }
          ],
          [{ text: "📋 Главное меню", callback_data: "main_menu" }]
        ]
      }
    });
  }

  // --- 9. Выбор сегодняшней даты для удаления галереи ---
  else if (data.startsWith('delete_gallery_date_today_')) {
    const venueId = data.replace('delete_gallery_date_today_', '');
    const venueSnapshot = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    const venue = venueSnapshot.val();

    if (!venue) return bot.sendMessage(chatId, '❌ Ошибка: заведение не найдено.');

    // Московская дата
    const moscowTime = new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" });
    const date = new Date(moscowTime).toISOString().split('T')[0];

    // Обновляем информацию для удаления галереи
    deleteConfirmations.set(chatId, {
      venueId: venueId,
      venueName: venue.name,
      date: date,
      type: 'gallery'
    });

    bot.sendMessage(chatId, `❓ Вы точно хотите удалить галерею из заведения "${venue.name}" от ${date}?`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Да", callback_data: `confirm_delete_gallery_${venueId}_${date}` },
            { text: "❌ Нет", callback_data: "main_menu" }
          ]
        ]
      }
    });
  }

  // --- 10. Выбор другой даты для удаления галереи ---
  else if (data.startsWith('delete_gallery_date_custom_')) {
    const venueId = data.replace('delete_gallery_date_custom_', '');
    const venueSnapshot = await db.ref(`photoGalleryData/venues/${venueId}`).once('value');
    const venue = venueSnapshot.val();

    if (!venue) return bot.sendMessage(chatId, '❌ Ошибка: заведение не найдено.');

    bot.sendMessage(chatId, `🗓 Введите дату для удаления галереи "${venue.name}" (в формате YYYY-MM-DD):`);

    bot.once('message', async (dateMsg) => {
      const date = dateMsg.text.trim();
      
      // Простая валидация даты
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        bot.sendMessage(chatId, '❌ Неверный формат даты! Используйте YYYY-MM-DD');
        return showMainMenu(chatId);
      }

      // Обновляем информацию для удаления галереи
      deleteConfirmations.set(chatId, {
        venueId: venueId,
        venueName: venue.name,
        date: date,
        type: 'gallery'
      });

      bot.sendMessage(chatId, `❓ Вы точно хотите удалить галерею из заведения "${venue.name}" от ${date}?`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Да", callback_data: `confirm_delete_gallery_${venueId}_${date}` },
              { text: "❌ Нет", callback_data: "main_menu" }
            ]
          ]
        }
      });
    });
  }

  // --- 11. Подтверждение удаления галереи ---
  else if (data.startsWith('confirm_delete_gallery_')) {
    const parts = data.replace('confirm_delete_gallery_', '').split('_');
    const venueId = parts[0];
    const date = parts.slice(1).join('_'); // На случай, если в дате есть дополнительные символы
    
    const confirmation = deleteConfirmations.get(chatId);

    if (!confirmation || confirmation.venueId !== venueId) {
      bot.sendMessage(chatId, '❌ Ошибка подтверждения. Начните удаление заново.');
      deleteConfirmations.delete(chatId);
      return showMainMenu(chatId);
    }

    // Удаляем галерею
    await db.ref(`photoGalleryData/photos/${venueId}/${date}`).remove();

    bot.sendMessage(
      chatId,
      `✅ Вы успешно удалили галерею для заведения "${confirmation.venueName}" за ${date}`,
      menu
    );

    // Очищаем подтверждение
    deleteConfirmations.delete(chatId);
  }
});

// === Главное меню ===
function showMainMenu(chatId) {
  bot.sendMessage(chatId, 'Вы в главном меню, выберите дальнейшее действие:', menu);
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
  const buttons = [];

  for (const [id, venue] of Object.entries(data)) {
    text += `🏠 ${venue.name}\n`;
    text += `🆔 ${id}\n`;
    text += `🖼 Лого: ${venue.image}\n\n`;
  }

  // Добавляем кнопку "Главное меню"
  buttons.push([{ text: "📋 Главное меню", callback_data: "main_menu" }]);

  bot.sendMessage(msg.chat.id, text, {
    reply_markup: {
      inline_keyboard: buttons
    }
  });
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

  buttons.push([{ text: "📋 Главное меню", callback_data: "main_menu" }]);

  bot.sendMessage(msg.chat.id, 'Выбери заведение для удаления:', {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
});

// Обработка ошибок
bot.on('polling_error', (error) => {
  console.log('Polling error:', error);
});
// --- Для Render, чтобы был открыт порт ---
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('✅ Telegram Gallery Bot is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});


console.log('🤖 Бот запущен и готов к работе!');