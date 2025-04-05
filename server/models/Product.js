// server/models/Product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  description: String,
  features: [String],
  tags: [String],
  imageUrl: String,
  rating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
module.exports = Product;

// server/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  preferences: {
    categories: [String],
    priceRange: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 1000 }
    },
    tags: [String]
  },
  viewHistory: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    viewedAt: { type: Date, default: Date.now }
  }],
  purchases: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    purchasedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
module.exports = User;

// server/services/recommendationService.js
const Product = require('../models/Product');
const User = require('../models/User');

/**
 * Calculates a similarity score between user preferences and a product
 * @param {Object} userPreferences - User's preferences
 * @param {Object} product - Product to compare against
 * @returns {Number} Similarity score (0-1)
 */
const calculateSimilarityScore = (userPreferences, product) => {
  let score = 0;
  let maxScore = 0;
  
  // Category match (highest weight)
  if (userPreferences.categories && userPreferences.categories.length > 0) {
    maxScore += 0.4;
    if (userPreferences.categories.includes(product.category)) {
      score += 0.4;
    }
  }
  
  // Price range match
  if (userPreferences.priceRange) {
    maxScore += 0.3;
    if (product.price >= userPreferences.priceRange.min && 
        product.price <= userPreferences.priceRange.max) {
      score += 0.3;
    }
  }
  
  // Tags match
  if (userPreferences.tags && userPreferences.tags.length > 0 && product.tags) {
    maxScore += 0.3;
    const matchingTags = product.tags.filter(tag => 
      userPreferences.tags.includes(tag)
    );
    
    score += (matchingTags.length / Math.max(userPreferences.tags.length, 1)) * 0.3;
  }
  
  // Normalize score if we have preferences
  return maxScore > 0 ? score / maxScore : 0;
};

/**
 * Gets collaborative filtering recommendations based on similar users
 * @param {String} userId - Current user ID
 * @param {Number} limit - Number of recommendations to return
 * @returns {Promise<Array>} - Array of product recommendations
 */
const getCollaborativeRecommendations = async (userId, limit = 5) => {
  try {
    const user = await User.findById(userId);
    if (!user) return [];
    
    // Get products the user has viewed or purchased
    const userProductIds = [
      ...user.viewHistory.map(item => item.productId.toString()),
      ...user.purchases.map(item => item.productId.toString())
    ];
    
    // Find users with similar view/purchase history
    const similarUsers = await User.find({
      _id: { $ne: userId },
      $or: [
        { 'viewHistory.productId': { $in: userProductIds } },
        { 'purchases.productId': { $in: userProductIds } }
      ]
    }).limit(10);
    
    // Get products that similar users have viewed/purchased but current user hasn't
    const similarUserProductIds = new Set();
    
    for (const similarUser of similarUsers) {
      const viewedProducts = similarUser.viewHistory.map(item => item.productId.toString());
      const purchasedProducts = similarUser.purchases.map(item => item.productId.toString());
      
      [...viewedProducts, ...purchasedProducts].forEach(productId => {
        if (!userProductIds.includes(productId)) {
          similarUserProductIds.add(productId);
        }
      });
    }
    
    // Convert Set to Array and find the actual products
    const recommendations = await Product.find({
      _id: { $in: Array.from(similarUserProductIds) }
    }).limit(limit);
    
    return recommendations;
  } catch (error) {
    console.error('Error getting collaborative recommendations:', error);
    return [];
  }
};

/**
 * Gets content-based recommendations based on user preferences
 * @param {String} userId - Current user ID
 * @param {Number} limit - Number of recommendations to return
 * @returns {Promise<Array>} - Array of product recommendations
 */
const getContentBasedRecommendations = async (userId, limit = 5) => {
  try {
    const user = await User.findById(userId);
    if (!user || !user.preferences) return [];
    
    // Get products the user has already viewed or purchased
    const userProductIds = [
      ...user.viewHistory.map(item => item.productId.toString()),
      ...user.purchases.map(item => item.productId.toString())
    ];
    
    // Find all products
    const allProducts = await Product.find({
      _id: { $nin: userProductIds } // Exclude products the user has already interacted with
    });
    
    // Calculate similarity scores for each product
    const scoredProducts = allProducts.map(product => ({
      product,
      score: calculateSimilarityScore(user.preferences, product)
    }));
    
    // Sort by score (descending) and return top results
    return scoredProducts
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.product);
  } catch (error) {
    console.error('Error getting content-based recommendations:', error);
    return [];
  }
};

/**
 * Gets trending products based on view count and ratings
 * @param {Number} limit - Number of trending products to return
 * @returns {Promise<Array>} - Array of trending products
 */
const getTrendingProducts = async (limit = 5) => {
  try {
    // Find products with high ratings and review counts
    return await Product.find()
      .sort({ reviewCount: -1, rating: -1 })
      .limit(limit);
  } catch (error) {
    console.error('Error getting trending products:', error);
    return [];
  }
};

/**
 * Main recommendation function that combines different recommendation strategies
 * @param {String} userId - Current user ID
 * @param {Number} limit - Total number of recommendations to return
 * @returns {Promise<Object>} - Object containing different types of recommendations
 */
const getRecommendations = async (userId, limit = 10) => {
  try {
    // If no user ID provided, just return trending products
    if (!userId) {
      const trending = await getTrendingProducts(limit);
      return {
        recommendations: trending,
        trending
      };
    }
    
    // For logged-in users, get personalized recommendations
    const [contentBased, collaborative, trending] = await Promise.all([
      getContentBasedRecommendations(userId, Math.floor(limit / 2)),
      getCollaborativeRecommendations(userId, Math.floor(limit / 2)),
      getTrendingProducts(Math.floor(limit / 3))
    ]);
    
    // Combine and deduplicate recommendations
    const seenIds = new Set();
    const combinedRecommendations = [];
    
    // First add collaborative recommendations (highest priority)
    for (const product of collaborative) {
      const id = product._id.toString();
      if (!seenIds.has(id)) {
        seenIds.add(id);
        combinedRecommendations.push(product);
      }
    }
    
    // Then add content-based recommendations
    for (const product of contentBased) {
      const id = product._id.toString();
      if (!seenIds.has(id)) {
        seenIds.add(id);
        combinedRecommendations.push(product);
      }
    }
    
    // If we still need more, add trending products
    for (const product of trending) {
      const id = product._id.toString();
      if (!seenIds.has(id) && combinedRecommendations.length < limit) {
        seenIds.add(id);
        combinedRecommendations.push(product);
      }
    }
    
    return {
      recommendations: combinedRecommendations.slice(0, limit),
      contentBased,
      collaborative,
      trending
    };
  } catch (error) {
    console.error('Error getting recommendations:', error);
    return {
      recommendations: [],
      contentBased: [],
      collaborative: [],
      trending: []
    };
  }
};

/**
 * Records a product view for a user
 * @param {String} userId - User ID
 * @param {String} productId - Product ID
 */
const recordProductView = async (userId, productId) => {
  try {
    await User.findByIdAndUpdate(userId, {
      $push: {
        viewHistory: {
          productId,
          viewedAt: new Date()
        }
      }
    });
  } catch (error) {
    console.error('Error recording product view:', error);
  }
};

/**
 * Records a product purchase for a user
 * @param {String} userId - User ID
 * @param {String} productId - Product ID
 */
const recordProductPurchase = async (userId, productId) => {
  try {
    await User.findByIdAndUpdate(userId, {
      $push: {
        purchases: {
          productId,
          purchasedAt: new Date()
        }
      }
    });
  } catch (error) {
    console.error('Error recording product purchase:', error);
  }
};

/**
 * Updates user preferences
 * @param {String} userId - User ID
 * @param {Object} preferences - Updated preferences
 */
const updateUserPreferences = async (userId, preferences) => {
  try {
    await User.findByIdAndUpdate(userId, {
      preferences
    });
  } catch (error) {
    console.error('Error updating user preferences:', error);
  }
};

module.exports = {
  getRecommendations,
  recordProductView,
  recordProductPurchase,
  updateUserPreferences
};

// server/routes/recommendations.js
const express = require('express');
const router = express.Router();
const recommendationService = require('../services/recommendationService');
const authMiddleware = require('../middleware/auth'); // Assume you have auth middleware

// Get recommendations for the current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    
    const recommendations = await recommendationService.getRecommendations(userId, limit);
    res.json(recommendations);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ message: 'Error fetching recommendations' });
  }
});

// Get trending products (no auth required)
router.get('/trending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const trending = await recommendationService.getTrendingProducts(limit);
    res.json(trending);
  } catch (error) {
    console.error('Error fetching trending products:', error);
    res.status(500).json({ message: 'Error fetching trending products' });
  }
});

// Record a product view
router.post('/view/:productId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.productId;
    
    await recommendationService.recordProductView(userId, productId);
    res.status(200).json({ message: 'View recorded' });
  } catch (error) {
    console.error('Error recording view:', error);
    res.status(500).json({ message: 'Error recording view' });
  }
});

// Record a product purchase
router.post('/purchase/:productId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.productId;
    
    await recommendationService.recordProductPurchase(userId, productId);
    res.status(200).json({ message: 'Purchase recorded' });
  } catch (error) {
    console.error('Error recording purchase:', error);
    res.status(500).json({ message: 'Error recording purchase' });
  }
});

// Update user preferences
router.put('/preferences', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = req.body;
    
    await recommendationService.updateUserPreferences(userId, preferences);
    res.status(200).json({ message: 'Preferences updated' });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ message: 'Error updating preferences' });
  }
});

module.exports = router;

// server/server.js - modified to include recommendation routes
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const recommendationRoutes = require('./routes/recommendations');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/yourapp')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Could not connect to MongoDB', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/recommendations', recommendationRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});