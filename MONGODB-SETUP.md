# MongoDB Hybrid Storage Setup Guide

This guide will help you set up dual storage (MongoDB + IndexedDB) for your Study Companion app to prevent data loss.

## 🚀 Quick Setup

### Prerequisites
1. **MongoDB installed locally** OR **MongoDB Atlas account**
2. **Node.js** (for the MongoDB API server)

### Step 1: Install MongoDB
```bash
# Option A: Local MongoDB
# macOS
brew install mongodb-community
brew services start mongodb-community

# Option B: MongoDB Atlas (Cloud)
# 1. Go to https://www.mongodb.com/atlas
# 2. Create a free account
# 3. Create a cluster
# 4. Get your connection string
```

### Step 2: Setup MongoDB API Server
```bash
# Install dependencies
cp package-mongo.json package.json
npm install

# Start the MongoDB API server
npm start
```

The API server will run on `http://localhost:3001`

### Step 3: Configure Environment
```bash
# Copy environment file
cp .env.example .env

# Edit .env with your MongoDB connection
MONGODB_URI=mongodb://localhost:27017/study-companion
REACT_APP_MONGO_API_URL=http://localhost:3001/api
```

### Step 4: Restart Your App
```bash
# Stop current dev server (Ctrl+C)
# Restart with new environment
npm run dev
```

## 📊 How It Works

### Dual Storage Architecture
```
📱 Study Companion App
├── 🗄️  IndexedDB (Local) - Fast, always available
├── 🌐 MongoDB (Cloud) - Backup, sync between devices
└── 🔄 Auto-sync - Saves to both automatically
```

### Data Flow
1. **Primary Storage**: IndexedDB (instant access)
2. **Auto Backup**: MongoDB (when online)
3. **Sync**: Automatic bidirectional sync
4. **Fallback**: Local storage works even if MongoDB is down

## 🔧 Features

### ✅ What You Get
- **Automatic Backup**: Every save goes to MongoDB
- **Offline Support**: Works without internet
- **Cross-Device Sync**: Access notes on any device
- **Data Recovery**: Restore from MongoDB if local data is lost
- **Real-time Status**: See sync status in the app

### 🛡️ Data Protection
- **Dual Storage**: Data exists in two places
- **Automatic Sync**: No manual backup needed
- **Conflict Resolution**: Smart merge for simultaneous edits
- **Version History**: Track changes over time

## 📱 Using the Hybrid Storage

### In the App
1. **Upload PDFs** - Works normally, saves to both storages
2. **Take Notes** - Instant local save, async MongoDB backup
3. **Sync Status** - See connection status in console
4. **Manual Sync** - Force backup/restore if needed

### Sync Commands (Advanced)
```javascript
// Manual backup to MongoDB
await storage.backupToMongoDB();

// Restore from MongoDB
await storage.restoreFromMongoDB();

// Check sync status
const isOnline = storage.isMongoOnline();
const lastSync = storage.getLastSyncTime();
```

## 🚨 Troubleshooting

### MongoDB Connection Issues
```bash
# Check if MongoDB is running
brew services list | grep mongodb

# Restart MongoDB
brew services restart mongodb-community

# Check API server
curl http://localhost:3001/api/health
```

### Sync Issues
1. **Check console** for sync errors
2. **Verify API server** is running
3. **Check network** connection
4. **Manual sync** if auto-sync fails

### Data Recovery
If local data is lost:
1. **Start the app** (MongoDB must be online)
2. **Open browser console**
3. **Run**: `await storage.restoreFromMongoDB()`
4. **Refresh the page**

## 🌐 MongoDB Atlas Setup (Cloud)

### Step 1: Create Atlas Account
1. Go to https://www.mongodb.com/atlas
2. Sign up for free tier
3. Create a new cluster

### Step 2: Configure Network
1. Go to "Network Access"
2. Add IP: `0.0.0.0/0` (allows all IPs)
3. Create a database user

### Step 3: Get Connection String
1. Go to "Database" → "Connect"
2. Choose "Connect your application"
3. Copy the connection string
4. Update your `.env` file

### Step 4: Update Environment
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/study-companion
```

## 📈 Benefits

### Before (Local Only)
- ❌ Data loss if browser clears storage
- ❌ No backup between devices
- ❌ Manual export required
- ❌ Single point of failure

### After (Hybrid Storage)
- ✅ Automatic cloud backup
- ✅ Cross-device synchronization
- ✅ Offline functionality
- ✅ Data recovery protection
- ✅ Peace of mind

## 🎯 Best Practices

1. **Keep MongoDB running** for continuous backup
2. **Check sync status** periodically
3. **Export important notes** as additional backup
4. **Monitor storage usage** in both systems
5. **Test recovery** process occasionally

## 📞 Support

If you encounter issues:
1. Check the MongoDB API server logs
2. Verify browser console for errors
3. Test MongoDB connection separately
4. Check network connectivity

Your data is now protected with dual storage! 🎉
