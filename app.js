const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const ContactRequest = require('./models/contactRequest');
dotenv.config();

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(require('express-session')({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Pass user to all views
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  next();
});

// MongoDB Connection with error handling
mongoose.connect('mongodb://localhost:27017/qr-menu', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit process if DB connection fails
  });

// Models
const User = require('./models/user');
const Menu = require('./models/menu');

// Passport Config
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Multer for Image Uploads
const storage = multer.diskStorage({
  destination: './public/uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage }).fields([
  { name: 'image', maxCount: 1 },
  { name: 'itemImage', maxCount: 50 }
]);

const uploadProfile = multer({ storage }).fields([
  { name: 'restaurantPhoto', maxCount: 1 }
]);

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
    res.render('my-menus', { menus });
  } catch (err) {
    console.error('Error fetching menus:', err);
    res.status(500).send('An error occurred while fetching your menus.');
  }
});

app.get('/edit-menu/:id', isLoggedIn, async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id);
    if (!menu || menu.owner.toString() !== req.user._id.toString()) {
      return res.status(404).send('Menu not found or not yours');
    }
    res.render('edit-menu', { menu });
  } catch (err) {
    console.error('Error fetching menu for edit:', err);
    res.status(500).send('An error occurred while loading the menu.');
  }
});

app.get('/profile', isLoggedIn, (req, res) => res.render('profile'));

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).send('An error occurred during logout.');
    }
    res.redirect('/');
  });
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
      res.redirect('/my-menus');
    }
  } catch (err) {
    console.error('Login redirect error:', err);
    res.status(500).send('An error occurred after login.');
  }
});

app.post('/create-menu', isLoggedIn, (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).send('File upload error: ' + err.message);
    } else if (err) {
      return res.status(500).send('Unknown upload error: ' + err.message);
    }
    next();
  });
}, async (req, res) => {
  try {
    const uniqueLink = Math.random().toString(36).substring(2, 10);
    const categories = [];
    const { categoryName, itemName, ingredients, allergens, price } = req.body;
    const itemImages = req.files['itemImage'] || [];

    if (categoryName) {
      const names = Array.isArray(categoryName) ? categoryName : [categoryName];
      names.forEach((name, catIndex) => {
        const items = [];
        const itemNames = Array.isArray(itemName[catIndex]) ? itemName[catIndex] : [itemName[catIndex]];
        const itemIngredients = Array.isArray(ingredients[catIndex]) ? ingredients[catIndex] : [ingredients[catIndex]];
        const itemAllergens = Array.isArray(allergens[catIndex]) ? allergens[catIndex] : [allergens[catIndex]];
        const itemPrices = Array.isArray(price[catIndex]) ? price[catIndex] : [price[catIndex]];

        itemNames.forEach((name, itemIndex) => {
          if (name) {
            items.push({
              name,
              ingredients: itemIngredients[itemIndex] || '',
              allergens: itemAllergens[itemIndex] || '',
              price: parseFloat(itemPrices[itemIndex]) || 0,
              image: itemImages.length > 0 && itemImages[catIndex * 10 + itemIndex] ? `/uploads/${itemImages[catIndex * 10 + itemIndex].filename}` : null
            });
          }
        });
        if (items.length > 0) {
          categories.push({ name, items });
        }
      });
    }

    const menu = new Menu({
      title: req.body.title,
      categories,
      image: req.files['image'] ? `/uploads/${req.files['image'][0].filename}` : null,
      link: uniqueLink,
      owner: req.user._id
    });
    await menu.save();
    res.redirect('/my-menus');
  } catch (err) {
    console.error('Error creating menu:', err);
    res.status(500).send('An error occurred while creating the menu.');
  }
});

app.post('/edit-menu/:id', isLoggedIn, (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).send('File upload error: ' + err.message);
    } else if (err) {
      return res.status(500).send('Unknown upload error: ' + err.message);
    }
    next();
  });
}, async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id);
    if (!menu || menu.owner.toString() !== req.user._id.toString()) {
      return res.status(403).send('Unauthorized');
    }
    menu.title = req.body.title || menu.title;

    const { categoryName, itemName, ingredients, allergens, price } = req.body;
    const itemImages = req.files['itemImage'] || [];

    if (categoryName) {
      const names = Array.isArray(categoryName) ? categoryName : [categoryName];
      menu.categories = [];
      names.forEach((name, catIndex) => {
        const items = [];
        const itemNames = Array.isArray(itemName[catIndex]) ? itemName[catIndex] : [itemName[catIndex]];
        const itemIngredients = Array.isArray(ingredients[catIndex]) ? ingredients[catIndex] : [ingredients[catIndex]];
        const itemAllergens = Array.isArray(allergens[catIndex]) ? allergens[catIndex] : [allergens[catIndex]];
        const itemPrices = Array.isArray(price[catIndex]) ? price[catIndex] : [price[catIndex]];

        itemNames.forEach((name, itemIndex) => {
          if (name) {
            items.push({
              name,
              ingredients: itemIngredients[itemIndex] || '',
              allergens: itemAllergens[itemIndex] || '',
              price: parseFloat(itemPrices[itemIndex]) || 0,
              image: itemImages.length > 0 && itemImages[catIndex * 10 + itemIndex] ? `/uploads/${itemImages[catIndex * 10 + itemIndex].filename}` : (menu.categories[catIndex]?.items[itemIndex]?.image || null)
            });
          }
        });
        if (items.length > 0) {
          menu.categories.push({ name, items });
        }
      });
    }

    if (req.files['image']) menu.image = `/uploads/${req.files['image'][0].filename}`;
    await menu.save();
    res.redirect('/my-menus');
  } catch (err) {
    console.error('Error updating menu:', err);
    res.status(500).send('An error occurred while updating the menu.');
  }
});

app.post('/profile', isLoggedIn, (req, res, next) => {
  uploadProfile(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).send('File upload error: ' + err.message);
    } else if (err) {
      return res.status(500).send('Unknown upload error: ' + err.message);
    }
    next();
  });
}, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).send('User not found');
    }
    user.restaurantName = req.body.restaurantName || user.restaurantName;
    user.restaurantAddress = req.body.restaurantAddress || user.restaurantAddress;
    if (req.files['restaurantPhoto']) user.restaurantPhoto = `/uploads/${req.files['restaurantPhoto'][0].filename}`;
    await user.save();
    res.redirect('/profile');
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).send('An error occurred while updating your profile.');
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
    res.render('menu-public', { menu });
  } catch (err) {
    console.error('Error fetching public menu:', err);
    res.status(500).send('An error occurred while loading the menu.');
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