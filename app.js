require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const ContactRequest = require('./models/contactRequest');
const uri = process.env.MONGO_URI;
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const fs = require('fs');
const Table = require('./models/table');
const Order = require('./models/order');



const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(require('express-session')({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

// Pass user to all views
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  next();
});


// LOCAL

//MongoDB Connection with error handling

mongoose.connect('mongodb://localhost:27017/qr-menu', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit process if DB connection fails
  });


//REAL
  // MongoDB Connection with error handling
// mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
//   .then(() => console.log('MongoDB connected'))
//   .catch(err => {
//     console.error('MongoDB connection error:', err);
//     process.exit(1); // Exit process if DB connection fails
//   });


// Models
const User = require('./models/user');
const Menu = require('./models/menu');

// Passport Config
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

const storage = multer.diskStorage({
  destination: './public/uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Accept 'image' and any 'itemImage[catIndex][itemIndex]' fields
    if (file.fieldname === 'image' || file.fieldname.match(/^itemImage\[\d+\]\[\d+\]$/)) {
      cb(null, true);
    } else {
      cb(new MulterError('Unexpected field'), false);
    }
  }
}).any();


const uploadProfile = multer({ storage }).fields([
  { name: 'restaurantPhoto', maxCount: 1 }
]);



const uploadCSV = multer({ storage }).single('menuFile'); // For /import-menu

// Middleware to check login
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/'); // Changed to redirect to home page since login is now modal-based
}

// Middleware to check if user is admin
function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }
  res.redirect('/');
}

// Routes
app.get('/', (req, res) => res.render('index'));

app.get('/create-menu', isLoggedIn, (req, res) => res.render('create-menu'));


app.get('/my-menus', isLoggedIn, async (req, res) => {
  try {
    const menus = await Menu.find({ owner: req.user._id });
    const tables = await Table.find({ menu: { $in: menus.map(m => m._id) } });
    res.render('my-menus', { menus, tables, newMenu: req.query.newMenu });
  } catch (err) {
    console.error('Error fetching menus:', err);
    res.status(500).send('An error occurred while fetching your menus.');
  }
});




// Admin dashboard route
app.get('/admin-dashboard', isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const allMenus = await Menu.find().populate('owner');
    const contactRequests = await ContactRequest.find();
    res.render('admin-dashboard', { totalUsers, allMenus, contactRequests });
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    res.status(500).send('An error occurred while loading the admin dashboard.');
  }
});



app.post('/submit-request', async (req, res) => {
  try {
    const { restaurantName, contactName, email, phone, plan, message } = req.body;
    const contactRequest = new ContactRequest({
      restaurantName,
      contactName,
      email,
      phone,
      plan,
      message
    });
    await contactRequest.save();
    res.redirect('/');
  } catch (err) {
    console.error('Error saving contact request:', err);
    res.status(500).send('An error occurred while submitting your request.');
  }
});
app.post('/login', passport.authenticate('local', { failureRedirect: '/' }), (req, res) => {
  try {
    if (req.user.role === 'admin') {
      res.redirect('/admin-dashboard');
    } else {
      res.redirect('/orders'); // Changed from '/my-menus'
    }
  } catch (err) {
    console.error('Login redirect error:', err);
    res.status(500).send('An error occurred after login.');
  }
});
app.post('/register', async (req, res) => {
  try {
    const newUser = new User({ username: req.body.username });
    await User.register(newUser, req.body.password);
    passport.authenticate('local')(req, res, () => {
      res.redirect('/profile');
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(400).send('Registration failed: ' + (err.message || 'Unknown error'));
  }
});

app.post('/create-menu', isLoggedIn, upload, async (req, res) => {
  try {
    const uniqueLink = require('uuid').v4();
    const { title, categoryName, itemName = {}, itemIngredients = {}, price = {} } = req.body;
    const uploadedFiles = req.files || [];

    const menu = new Menu({
      title,
      categories: [],
      link: uniqueLink,
      owner: req.user._id
    });

    if (categoryName) {
      const names = Array.isArray(categoryName) ? categoryName : [categoryName];
      names.forEach((name, catIndex) => {
        const items = [];
        const itemNames = Array.isArray(itemName[catIndex]) ? itemName[catIndex] : (itemName[catIndex] ? [itemName[catIndex]] : []);
        const itemIngreds = Array.isArray(itemIngredients[catIndex]) ? itemIngredients[catIndex] : (itemIngredients[catIndex] ? [itemIngredients[catIndex]] : []);
        const itemPrices = Array.isArray(price[catIndex]) ? price[catIndex] : (price[catIndex] ? [price[catIndex]] : []);

        itemNames.forEach((name, itemIndex) => {
          if (name) {
            const fieldName = `itemImage[${catIndex}][${itemIndex}]`;
            const uploadedImageFile = uploadedFiles.find(f => f.fieldname === fieldName);
            const uploadedImage = uploadedImageFile ? `/uploads/${uploadedImageFile.filename}` : null;
            items.push({
              name,
              ingredients: itemIngreds[itemIndex] || '',
              allergens: '',
              price: parseFloat(itemPrices[itemIndex]) || 0,
              image: uploadedImage
            });
          }
        });
        if (items.length > 0) {
          menu.categories.push({ name, items });
        }
      });
    }

    const menuImageFile = uploadedFiles.find(f => f.fieldname === 'image');
    if (menuImageFile) {
      menu.image = `/uploads/${menuImageFile.filename}`;
    }

    await menu.save();
    res.redirect(`/my-menus?newMenu=${menu._id}`);
  } catch (err) {
    console.error('Error creating menu:', err);
    res.status(500).send('An error occurred while creating the menu.');
  }
});

app.post('/edit-menu/:id', isLoggedIn, upload, async (req, res) => {
  try {

    const menu = await Menu.findById(req.params.id);
    if (!menu || menu.owner.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized');
    }
    menu.title = req.body.title || menu.title;

    const { categoryName, itemName = {}, price = {}, existingItemImage = {}, existingMenuImage } = req.body;
    const uploadedFiles = req.files || [];

    if (categoryName) {
      const names = Array.isArray(categoryName) ? categoryName : [categoryName];
      menu.categories = [];

      names.forEach((name, catIndex) => {
        const items = [];
        const itemNames = Array.isArray(itemName[catIndex]) ? itemName[catIndex] : (itemName[catIndex] ? [itemName[catIndex]] : []);
        const itemPrices = Array.isArray(price[catIndex]) ? price[catIndex] : (price[catIndex] ? [price[catIndex]] : []);
        const existingImages = Array.isArray(existingItemImage[catIndex]) ? existingItemImage[catIndex] : (existingItemImage[catIndex] ? [existingItemImage[catIndex]] : []);

        itemNames.forEach((name, itemIndex) => {
          if (name) {
            const fieldName = `itemImage[${catIndex}][${itemIndex}]`;
            const uploadedImageFile = uploadedFiles.find(f => f.fieldname === fieldName);
            const uploadedImage = uploadedImageFile ? `/uploads/${uploadedImageFile.filename}` : existingImages[itemIndex];
            items.push({
              name,
              ingredients: '', // Match create-menu; edit-menu doesn’t use these yet
              allergens: '',   // Match create-menu; edit-menu doesn’t use these yet
              price: parseFloat(itemPrices[itemIndex]) || 0,
              image: uploadedImage || null
            });
          }
        });
        if (items.length > 0) {
          menu.categories.push({ name, items });
        }
      });
    }

    const menuImageFile = uploadedFiles.find(f => f.fieldname === 'image');
    if (menuImageFile) {
      menu.image = `/uploads/${menuImageFile.filename}`;
    } else {
      menu.image = existingMenuImage || menu.image;
    }

    await menu.save();
    res.redirect('/my-menus');
  } catch (err) {
    console.error('Error updating menu:', err);
    res.status(500).send('An error occurred while updating the menu.');
  }
});

app.get('/edit-menu/:id', isLoggedIn, async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id);
    if (!menu || menu.owner.toString() !== req.user._id.toString()) {
      return res.status(404).send('Menu not found or not yours');
    }
    res.render('edit-menu', { menu, currentUser: req.user });
  } catch (err) {
    console.error('Error fetching menu for edit:', err);
    res.status(500).send('An error occurred while loading the menu.');
  }
});


app.post('/delete-profile', isLoggedIn, async (req, res) => {
  try {
    const userId = req.user._id;
    await Menu.deleteMany({ owner: userId });
    await User.findByIdAndDelete(userId);
    req.logout((err) => {
      if (err) {
        console.error('Logout error during profile deletion:', err);
        return res.status(500).send('An error occurred during logout.');
      }
      res.redirect('/');
    });
  } catch (err) {
    console.error('Error deleting profile:', err);
    res.status(500).send('An error occurred while deleting your profile.');
  }
});

app.get('/menu/:link', async (req, res) => {
  try {
    const menu = await Menu.findOne({ link: req.params.link }).populate('owner');
    if (!menu) return res.status(404).send('Menu not found');
    const tableId = req.query.table || '';
    let tableNumber = 'Unknown';
    if (tableId) {
      const table = await Table.findById(tableId);
      tableNumber = table ? table.number : 'Unknown';
    }
    res.render('menu-public', { menu, tableId, tableNumber });
  } catch (err) {
    console.error('Error fetching public menu:', err);
    res.status(500).send('An error occurred while loading the menu.');
  }
});

app.get('/menu/:qrLink', async (req, res) => {
  try {
    const menu = await Menu.findOne({ link: req.params.link }).populate('owner');
    if (!menu) return res.status(404).send('Menu not found');
    res.render('menu-public', { menu });
  } catch (err) {
    console.error('Error fetching public menu:', err);
    res.status(500).send('An error occurred while loading the menu.');
  }
});

app.post('/delete-menu/:id', isLoggedIn, async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id);
    if (!menu || menu.owner.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized');
    }
    await Menu.findByIdAndDelete(req.params.id);
    res.redirect('/my-menus');
  } catch (err) {
    console.error('Error deleting menu:', err);
    res.status(500).send('An error occurred while deleting the menu.');
  }
});

app.get('/privacy-policy', (req, res) => {
  res.render('privacy-policy');
});

// Global error handler (catch unhandled errors)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).send('Something went wrong on the server.');
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));

app.post('/import-menu', isLoggedIn, uploadCSV, async (req, res) => {
  try {
    const categories = {};
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (row) => {
        if (!categories[row.Category]) categories[row.Category] = { name: row.Category, items: [] };
        categories[row.Category].items.push({
          name: row.Item_Name,
          price: parseFloat(row.Price) || 0
        });
      })
      .on('end', async () => {
        const uniqueLink = require('uuid').v4();
        const menu = new Menu({
          title: req.body.title || 'Imported Menu',
          categories: Object.values(categories),
          link: uniqueLink,
          owner: req.user._id
        });
        await menu.save();
        fs.unlinkSync(req.file.path); // Clean up temp file
        res.redirect(`/my-menus?newMenu=${menu._id}`); // Pass new menu ID
      });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).send('Failed to import menu');
  }
});

app.post('/create-tables/:menuId', isLoggedIn, async (req, res) => {
  try {
    const { tableCount } = req.body;
    const menu = await Menu.findById(req.params.menuId);
    if (!menu || menu.owner.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized');
    }
    const tables = [];
    const existingTables = await Table.find({ menu: menu._id });
    const startNum = existingTables.length + 1;

    for (let i = 0; i < tableCount; i++) {
      const table = new Table({
        menu: menu._id,
        number: `${startNum + i}`,
        qrLink: '' // Placeholder, updated after save
      });
      tables.push(table);
    }

    const savedTables = await Table.insertMany(tables);
    // Update qrLink with actual _id after saving
    for (const table of savedTables) {
      table.qrLink = `/menu/${menu.link}?table=${table._id}`;
      await table.save();
    }

    res.redirect('/my-menus');
  } catch (err) {
    console.error('Error creating tables:', err);
    res.status(500).send('An error occurred while creating tables.');
  }
});

app.post('/delete-table/:tableId', isLoggedIn, async (req, res) => {
  try {
    const table = await Table.findById(req.params.tableId).populate('menu');
    if (!table || table.menu.owner.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized');
    }
    await Table.findByIdAndDelete(req.params.tableId);
    res.redirect('/my-menus');
  } catch (err) {
    console.error('Table deletion error:', err);
    res.status(500).send('Failed to delete table');
  }
});

app.post('/menus/:id/mode', isLoggedIn, async (req, res) => {
  const { mode } = req.body;
  if (!mode) {
    return res.status(400).send('Mode is required');
  }
  const menu = await Menu.findById(req.params.id);
  if (!menu || menu.owner.toString() !== req.user._id.toString()) {
    return res.status(403).send('Unauthorized');
  }
  menu.mode = mode;
  await menu.save();
  console.log('Updated menu:', menu); // Success log
  res.sendStatus(200);
});

app.post('/menu/:link/order', async (req, res) => {
  try {
    const menu = await Menu.findOne({ link: req.params.link });
    if (!menu) return res.status(404).send('Menu not found');
    const { tableId, items } = req.body; // From client form
    const order = new Order({ menu: menu._id, tableId, items });
    await order.save();
    res.redirect(`/menu/${req.params.link}?order=placed`);
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).send('Failed to place order');
  }
});
app.post('/table/:qrLink/order', async (req, res) => {
  try {
    const table = await Table.findOne({ qrLink: req.params.qrLink });
    if (!table) return res.status(404).send('Table not found');
    const { items } = req.body; // Array of { name, customizations }
    const order = new Order({
      menu: table.menu,
      tableId: table.number,
      items: items.map(item => ({ ...item, price: 0 })) // Price lookup needed
    });
    await order.save();
    res.redirect(`/table/${req.params.qrLink}?order=placed`);
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).send('Failed to place order');
  }
});


app.post('/orders', async (req, res) => {
  try {
    const { menuId, items, tableId } = req.body;
    if (!menuId || !items || items.length === 0) {
      return res.status(400).send('Menu ID and items are required');
    }
    const order = new Order({
      menuId,
      items,
      tableId: tableId || null, // Allow null if tableId is missing
      createdAt: new Date()
    });
    await order.save();
    res.sendStatus(201);
  } catch (error) {
    console.error('Error saving order:', error);
    res.status(500).send('Failed to save order');
  }
});

app.post('/orders/:orderId/status', isLoggedIn, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.orderId).populate('menuId');
    if (!order || order.menuId.owner.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized');
    }
    order.status = status;
    await order.save();
    res.sendStatus(200);
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).send('An error occurred while updating the order status.');
  }
});


app.get('/orders', isLoggedIn, async (req, res) => {
  try {
    const orders = await Order.find({ menuId: { $in: await Menu.find({ owner: req.user._id }).select('_id') } })
      .populate('tableId', 'number')
      .sort({ createdAt: -1 });
    res.render('orders', { currentUser: req.user, orders });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).send('An error occurred while loading orders.');
  }
});

app.get('/profile', isLoggedIn, async (req, res) => {
  const orders = await Order.find({ menuId: { $in: await Menu.find({ owner: req.user._id }).select('_id') } })
    .populate('tableId', 'number');
  res.render('profile', { currentUser: req.user, orders });
});


app.post('/profile', isLoggedIn, uploadProfile, async (req, res) => {
  try {
    const { restaurantName, restaurantAddress } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).send('User not found');
    }

    // Update fields
    user.restaurantName = restaurantName !== undefined ? restaurantName : user.restaurantName;
    user.restaurantAddress = restaurantAddress !== undefined ? restaurantAddress : user.restaurantAddress;

    // Handle file upload (req.files is an object with field names)
    if (req.files && req.files['restaurantPhoto']) {
      user.restaurantPhoto = `/uploads/${req.files['restaurantPhoto'][0].filename}`;
    }

    await user.save();
    console.log('Profile updated:', user);
    res.redirect('/profile');
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).send('An error occurred while updating your profile.');
  }
});



app.post('/logout', (req, res) => {
  console.log('POST /logout route hit'); // Debug
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).send('An error occurred during logout.');
    }
    res.redirect('/');
  });
});