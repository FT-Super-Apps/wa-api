const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const mime = require('mime-types');

// Load environment variables
require('dotenv').config();

// Dynamic port configuration
const APP_NAME = process.env.APP_NAME || 'WA-API';
const APP_PORT_VAR = `${APP_NAME}-APP_PORT`;
const port = process.env[APP_PORT_VAR] || process.env.APP_PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 * 
 * Many people confused about the warning for file-upload
 * So, we just disabling the debug for simplicity.
 * 
 * Enhanced configuration for larger files
 */
app.use(fileUpload({
  debug: false,
  limits: { 
    fileSize: 100 * 1024 * 1024 // 100MB limit for uploads
  },
  useTempFiles: false, // Keep files in memory to avoid reading issues
  createParentPath: true
}));

app.get('/', (req, res) => {
  // Read the HTML file and replace placeholder with APP_NAME
  const path = require('path');
  const htmlPath = path.join(__dirname, 'index.html');
  
  fs.readFile(htmlPath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send('Error loading page');
    }
    
    // Replace the title with dynamic APP_NAME
    const modifiedHtml = data.replace(
      'Whatsapp-App-Name', 
      `Whatsapp API Server : ${APP_NAME}`
    );
    
    res.send(modifiedHtml);
  });
});

const wwebVersion = '2.2410.1';


const client = new Client({
  authStrategy: new LocalAuth(),
  restartOnAuthFail: true,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // <- this one doesn't works in Windows
      '--disable-gpu'
    ],
  },
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2413.51-beta.html",
  },
});

// Fix EventEmitter memory leak warning
client.setMaxListeners(20);

client.on('message', msg => {
  if (msg.body == '!ping') {
    msg.reply('pong');
  } else if (msg.body == 'good morning') {
    msg.reply('selamat pagi');
  } else if (msg.body == '!groups') {
    client.getChats().then(chats => {
      const groups = chats.filter(chat => chat.isGroup);

      if (groups.length == 0) {
        msg.reply('You have no group yet.');
      } else {
        let replyMsg = '*YOUR GROUPS*\n\n';
        groups.forEach((group, i) => {
          replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
        });
        replyMsg += '_You can use the group id to send a message to the group._'
        msg.reply(replyMsg);
      }
    });
  }

  // NOTE!
  // UNCOMMENT THE SCRIPT BELOW IF YOU WANT TO SAVE THE MESSAGE MEDIA FILES
  // Downloading media
  // if (msg.hasMedia) {
  //   msg.downloadMedia().then(media => {
  //     // To better understanding
  //     // Please look at the console what data we get
  //     console.log(media);

  //     if (media) {
  //       // The folder to store: change as you want!
  //       // Create if not exists
  //       const mediaPath = './downloaded-media/';

  //       if (!fs.existsSync(mediaPath)) {
  //         fs.mkdirSync(mediaPath);
  //       }

  //       // Get the file extension by mime-type
  //       const extension = mime.extension(media.mimetype);
        
  //       // Filename: change as you want! 
  //       // I will use the time for this example
  //       // Why not use media.filename? Because the value is not certain exists
  //       const filename = new Date().getTime();

  //       const fullFilename = mediaPath + filename + '.' + extension;

  //       // Save to file
  //       try {
  //         fs.writeFileSync(fullFilename, media.data, { encoding: 'base64' }); 
  //         console.log('File downloaded successfully!', fullFilename);
  //       } catch (err) {
  //         console.log('Failed to save the file:', err);
  //       }
  //     }
  //   });
  // }
});

client.initialize();

// Socket IO
io.on('connection', function(socket) {
  socket.emit('message', 'Connecting...');

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit('qr', url);
      socket.emit('message', 'QR Code received, scan please!');
    });
  });

  client.on('ready', () => {
    socket.emit('ready', 'Whatsapp is ready!');
    socket.emit('message', 'Whatsapp is ready!');
  });

  client.on('authenticated', () => {
    socket.emit('authenticated', 'Whatsapp is authenticated!');
    socket.emit('message', 'Whatsapp is authenticated!');
    console.log('AUTHENTICATED');
  });

  client.on('auth_failure', function(session) {
    socket.emit('message', 'Auth failure, restarting...');
  });

  client.on('disconnected', (reason) => {
    socket.emit('message', 'Whatsapp is disconnected!');
    client.destroy();
    client.initialize();
  });
});


const checkRegisteredNumber = async function(number) {
  try {
    // Check if client is ready
    if (!client || !client.info) {
      throw new Error('WhatsApp client is not ready yet');
    }
    
    const isRegistered = await client.isRegisteredUser(number);
    return isRegistered;
  } catch (error) {
    console.error('Error checking registered number:', error);
    throw error;
  }
}

// Check client status
app.get('/status', (req, res) => {
  const isReady = client && client.info;
  res.status(200).json({
    status: true,
    client_ready: isReady,
    message: isReady ? 'WhatsApp client is ready' : 'WhatsApp client is not ready yet'
  });
});

// Check if number is registered
app.post('/is-registered', [
  body('number').notEmpty().withMessage('Number is required'),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  try {
    // Check if client is ready
    if (!client || !client.info) {
      return res.status(503).json({
        status: false,
        message: 'WhatsApp client is not ready yet. Please wait for initialization to complete.'
      });
    }

    const number = phoneNumberFormatter(req.body.number);
    const isRegistered = await client.isRegisteredUser(number);
    
    if (!isRegistered) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    } else {
      return res.status(200).json({
        status: true,
        message: 'The number is registered'
      });
    }
  } catch (error) {
    console.error('Error in /is-registered:', error);
    return res.status(500).json({
      status: false,
      message: 'Error checking number registration: ' + error.message
    });
  }
});

// Send message
app.post('/send-message', [
  body('number').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  try {
    // Check if client is ready
    if (!client || !client.info) {
      return res.status(503).json({
        status: false,
        message: 'WhatsApp client is not ready yet. Please wait for initialization to complete.'
      });
    }

    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;

    const isRegisteredNumber = await checkRegisteredNumber(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }

    client.sendMessage(number, message).then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    }).catch(err => {
      console.error('Error sending message:', err);
      res.status(500).json({
        status: false,
        response: err.message
      });
    });
  } catch (error) {
    console.error('Error in /send-message:', error);
    return res.status(500).json({
      status: false,
      message: 'Error processing request: ' + error.message
    });
  }
});

// Endpoint API untuk menambahkan nomor ke grup
app.post('/add-to-group', [
    body('number').notEmpty().withMessage('Nomor harus diisi'),
    body('groupid').notEmpty().withMessage('Group ID harus diisi')
], async (req, res) => {
    // Periksa apakah terdapat kesalahan validasi
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({ status: false, message: errors.mapped() });
    }

    const nomor = phoneNumberFormatter(req.body.number); // Memformat nomor telepon menggunakan fungsi phoneNumberFormatter

    try {
        // Periksa apakah nomor sudah terdaftar
        const isRegisteredNumber = await checkRegisteredNumber(nomor);
        if (!isRegisteredNumber) {
            return res.status(422).json({ status: false, message: 'Nomor tidak terdaftar' });
        }

        const groupid = req.body.groupid;

        // Mendapatkan objek grup berdasarkan ID grup yang diberikan
        const group = await client.getChatById(groupid);

        // Mendapatkan objek kontak berdasarkan nomor telepon yang diberikan
        //const contact = await client.getContactById(`${number}@c.us`);

        // Menambahkan kontak ke grup
        await group.addParticipants([nomor], { comment: 'Undangan Group CAMABA Unismuh Makassar' });

        res.status(200).json({ status: true, message: 'Nomor berhasil ditambahkan ke grup' });
    } catch (error) {
        console.error('Gagal menambahkan nomor ke grup:', error);
        res.status(500).json({ status: false, message: 'Gagal menambahkan nomor ke grup' });
    }
});

// Send media with file upload
app.post('/send-media', [
  body('number').notEmpty().withMessage('Number is required'),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  try {
    // Check if client is ready
    if (!client || !client.info) {
      return res.status(503).json({
        status: false,
        message: 'WhatsApp client is not ready yet. Please wait for initialization to complete.'
      });
    }

    const number = phoneNumberFormatter(req.body.number);
    const caption = req.body.caption || '';

    // Check if file is uploaded
    if (!req.files || !req.files.file) {
      return res.status(422).json({
        status: false,
        message: 'No file uploaded. Please upload a file.'
      });
    }

    const file = req.files.file;
    console.log('Processing uploaded file:', file.name, 'Size:', file.size, 'Type:', file.mimetype);
    console.log('File object keys:', Object.keys(file));
    console.log('Has data property:', 'data' in file);
    console.log('Has tempFilePath property:', 'tempFilePath' in file);
    
    // Debug file properties
    if (file.data) {
      console.log('File data type:', typeof file.data);
      console.log('File data is Buffer:', Buffer.isBuffer(file.data));
    }

    // Check file size based on file type (adjusted for WhatsApp Web limits)
    let maxSize;
    if (file.mimetype.startsWith('image/')) {
      maxSize = 16 * 1024 * 1024; // 16MB for images
    } else if (file.mimetype.startsWith('video/')) {
      maxSize = 64 * 1024 * 1024; // 64MB for videos (WhatsApp Web can handle larger videos)
    } else if (file.mimetype.startsWith('audio/')) {
      maxSize = 64 * 1024 * 1024; // 64MB for audio files (accommodate larger audio files)
    } else {
      maxSize = 100 * 1024 * 1024; // 100MB for documents
    }

    if (file.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      return res.status(422).json({
        status: false,
        message: `File size too large. Maximum size for ${file.mimetype.split('/')[0]} files is ${maxSizeMB}MB.`
      });
    }

    // Create media from uploaded file with enhanced error handling
    let media;
    try {
      console.log('Creating media object...');
      console.log('File data length:', file.data ? file.data.length : 'No data property');
      console.log('File mimetype:', file.mimetype);
      console.log('File name:', file.name);
      
      // Check if file data exists and is not empty
      if (!file.data || file.data.length === 0) {
        // If data property is empty, try reading from tempFilePath if available
        if (file.tempFilePath && fs.existsSync(file.tempFilePath)) {
          console.log('Reading file from tempFilePath:', file.tempFilePath);
          file.data = fs.readFileSync(file.tempFilePath);
          console.log('File read from temp path, size:', file.data.length);
        } else {
          throw new Error('File data is empty or not properly uploaded');
        }
      }
      
      // Convert file data to base64
      let base64Data;
      if (Buffer.isBuffer(file.data)) {
        base64Data = file.data.toString('base64');
      } else {
        base64Data = Buffer.from(file.data).toString('base64');
      }
      
      if (!base64Data || base64Data.length === 0) {
        throw new Error('Failed to convert file to base64');
      }
      
      // For Excel files, ensure proper mimetype
      let mimetype = file.mimetype;
      if (file.name.toLowerCase().endsWith('.xlsx') && !mimetype.includes('spreadsheetml')) {
        mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else if (file.name.toLowerCase().endsWith('.xls') && !mimetype.includes('excel')) {
        mimetype = 'application/vnd.ms-excel';
      }
      
      media = new MessageMedia(mimetype, base64Data, file.name);
      
      console.log('Media object created successfully');
      console.log('Media data length:', media.data ? media.data.length : 'undefined');
      console.log('Media mimetype:', media.mimetype);
      
      // Additional validation
      if (!media.data || media.data.length === 0) {
        throw new Error('Media object created but data is empty');
      }
      
    } catch (mediaError) {
      console.error('Error creating media object:', mediaError);
      return res.status(422).json({
        status: false,
        message: 'Failed to process uploaded file: ' + mediaError.message
      });
    }

    // Check if number is registered
    const isRegisteredNumber = await checkRegisteredNumber(number);
    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }

    // Send media message with extended timeout for larger files
    try {
      console.log('Sending media to WhatsApp...');
      const response = await Promise.race([
        client.sendMessage(number, media, { caption: caption }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Send media timeout after 120 seconds')), 120000) // Extended to 2 minutes
        )
      ]);
      
      console.log('Media sent successfully');
      res.status(200).json({
        status: true,
        message: 'Media sent successfully'
      });
      
    } catch (sendError) {
      console.error('Error sending media to WhatsApp:', sendError);
      
      // Provide more specific error messages
      let errorMessage = 'Error sending media';
      if (sendError.message.includes('timeout')) {
        errorMessage = 'Media sending timeout. Large files may take longer to process.';
      } else if (sendError.message.includes('Evaluation failed')) {
        errorMessage = 'WhatsApp Web failed to process the media file. This may happen with very large files or unsupported formats.';
      } else if (sendError.message.includes('Protocol error')) {
        errorMessage = 'Connection error with WhatsApp Web. Please try again.';
      } else if (sendError.message.includes('Target closed')) {
        errorMessage = 'WhatsApp Web connection lost. Please check your connection and try again.';
      }
      
      return res.status(500).json({
        status: false,
        message: errorMessage
      });
    }

  } catch (error) {
    console.error('Error in /send-media:', error);
    res.status(500).json({
      status: false,
      message: 'Error sending media: ' + error.message
    });
  }
});

const findGroupByName = async function(name) {
  const group = await client.getChats().then(chats => {
    return chats.find(chat => 
      chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
    );
  });
  return group;
}

// Send message to group
// You can use chatID or group name, yea!
app.post('/send-group-message', [
  body('id').custom((value, { req }) => {
    if (!value && !req.body.name) {
      throw new Error('Invalid value, you can use `id` or `name`');
    }
    return true;
  }),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  let chatId = req.body.id;
  const groupName = req.body.name;
  const message = req.body.message;

  // Find the group by name
  if (!chatId) {
    const group = await findGroupByName(groupName);
    if (!group) {
      return res.status(422).json({
        status: false,
        message: 'No group found with name: ' + groupName
      });
    }
    chatId = group.id._serialized;
  }

  client.sendMessage(chatId, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});


// Clearing message on spesific chat
app.post('/clear-message', [
  body('number').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'The number is not registered'
    });
  }

  const chat = await client.getChatById(number);
  
  chat.clearMessages().then(status => {
    res.status(200).json({
      status: true,
      response: status
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  })
});

server.listen(port, function() {
  console.log('App running on *: ' + port);
});
