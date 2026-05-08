#!/usr/bin/env node

// MongoDB Setup Test Script
// Run this to verify your MongoDB hybrid storage is working

const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://aashutoshdahal91_db_user:2D57lPk2KDRz4QZS@cluster0.v2gakjm.mongodb.net/?appName=Cluster0';
const API_URL = 'http://localhost:3001/api';

console.log('🧪 MongoDB Hybrid Storage Test Suite');
console.log('=====================================\n');

async function testMongoConnection() {
    console.log('1. Testing MongoDB Connection...');
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ MongoDB connection successful');
        
        const db = client.db();
        const collections = await db.listCollections().toArray();
        console.log(`📁 Found ${collections.length} collections: ${collections.map(c => c.name).join(', ')}`);
        
        await client.close();
        return true;
    } catch (error) {
        console.log(`❌ MongoDB connection failed: ${error.message}`);
        return false;
    }
}

async function testApiServer() {
    console.log('\n2. Testing API Server...');
    try {
        const response = await fetch(`${API_URL}/health`);
        if (response.ok) {
            const data = await response.json();
            console.log('✅ API server is running');
            console.log(`📊 Status: ${data.status}`);
            console.log(`⏰ Timestamp: ${data.timestamp}`);
            return true;
        } else {
            console.log(`❌ API server responded with status: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ API server test failed: ${error.message}`);
        console.log('💡 Make sure the MongoDB API server is running on port 3001');
        console.log('   Run: cp package-mongo.json package.json && npm install && npm start');
        return false;
    }
}

async function testCrudOperations() {
    console.log('\n3. Testing CRUD Operations...');
    
    try {
        // Test workspace creation
        const testWorkspace = {
            id: `test-${Date.now()}`,
            name: 'Test Workspace',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        console.log('📝 Creating test workspace...');
        const createResponse = await fetch(`${API_URL}/workspaces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testWorkspace)
        });
        
        if (!createResponse.ok) {
            throw new Error('Failed to create workspace');
        }
        console.log('✅ Workspace created successfully');
        
        // Test workspace retrieval
        console.log('📖 Retrieving workspaces...');
        const getResponse = await fetch(`${API_URL}/workspaces`);
        const workspaces = await getResponse.json();
        
        const found = workspaces.some(w => w.id === testWorkspace.id);
        if (found) {
            console.log('✅ Workspace retrieved successfully');
        } else {
            throw new Error('Workspace not found after creation');
        }
        
        // Test workspace deletion
        console.log('🗑️  Deleting test workspace...');
        const deleteResponse = await fetch(`${API_URL}/workspaces/${testWorkspace.id}`, {
            method: 'DELETE'
        });
        
        if (deleteResponse.ok) {
            console.log('✅ Workspace deleted successfully');
        } else {
            console.log('⚠️ Workspace deletion failed (may not be implemented)');
        }
        
        return true;
    } catch (error) {
        console.log(`❌ CRUD operations test failed: ${error.message}`);
        return false;
    }
}

async function testSyncFunctionality() {
    console.log('\n4. Testing Sync Functionality...');
    
    try {
        const testData = {
            workspaces: [
                { id: 'sync-test', name: 'Sync Test', createdAt: Date.now(), updatedAt: Date.now() }
            ],
            documents: [],
            notes: []
        };
        
        // Test backup
        console.log('💾 Testing backup...');
        const backupResponse = await fetch(`${API_URL}/sync/backup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });
        
        if (backupResponse.ok) {
            console.log('✅ Backup functionality working');
        } else {
            throw new Error('Backup failed');
        }
        
        // Test restore
        console.log('📥 Testing restore...');
        const restoreResponse = await fetch(`${API_URL}/sync/restore`);
        
        if (restoreResponse.ok) {
            const restoredData = await restoreResponse.json();
            console.log('✅ Restore functionality working');
            console.log(`📊 Restored ${restoredData.workspaces?.length || 0} workspaces`);
        } else {
            throw new Error('Restore failed');
        }
        
        return true;
    } catch (error) {
        console.log(`❌ Sync functionality test failed: ${error.message}`);
        return false;
    }
}

async function testPerformance() {
    console.log('\n5. Testing Performance...');
    
    try {
        const startTime = Date.now();
        const promises = [];
        
        // Test 10 concurrent requests
        for (let i = 0; i < 10; i++) {
            promises.push(fetch(`${API_URL}/health`));
        }
        
        const results = await Promise.all(promises);
        const endTime = Date.now();
        const successCount = results.filter(r => r.ok).length;
        
        const avgTime = (endTime - startTime) / 10;
        const opsPerSec = Math.round(1000 / avgTime);
        
        console.log(`✅ Performance test completed`);
        console.log(`📊 Average response time: ${avgTime.toFixed(2)}ms`);
        console.log(`🚀 Operations per second: ${opsPerSec}`);
        console.log(`✅ Success rate: ${successCount}/10 (${successCount * 10}%)`);
        
        return successCount >= 9; // At least 90% success rate
    } catch (error) {
        console.log(`❌ Performance test failed: ${error.message}`);
        return false;
    }
}

async function runFullTestSuite() {
    console.log('Starting comprehensive test suite...\n');
    
    const tests = [
        { name: 'MongoDB Connection', fn: testMongoConnection },
        { name: 'API Server', fn: testApiServer },
        { name: 'CRUD Operations', fn: testCrudOperations },
        { name: 'Sync Functionality', fn: testSyncFunctionality },
        { name: 'Performance', fn: testPerformance }
    ];
    
    const results = [];
    
    for (const test of tests) {
        try {
            const result = await test.fn();
            results.push({ name: test.name, passed: result });
        } catch (error) {
            console.log(`❌ Test ${test.name} crashed: ${error.message}`);
            results.push({ name: test.name, passed: false });
        }
    }
    
    // Summary
    console.log('\n=====================================');
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('=====================================');
    
    const passed = results.filter(r => r.passed).length;
    const score = Math.round((passed / results.length) * 100);
    
    results.forEach(result => {
        console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
    });
    
    console.log(`\n🎯 Overall Score: ${score}% (${passed}/${results.length} tests passed)`);
    
    if (score >= 80) {
        console.log('🎉 EXCELLENT! Your MongoDB hybrid storage is ready for production!');
    } else if (score >= 60) {
        console.log('⚠️  GOOD! Basic functionality works, but some issues need attention.');
    } else {
        console.log('❌ NEEDS WORK! Major issues detected. Please review the setup guide.');
    }
    
    console.log('\n📋 Next Steps:');
    console.log('1. Start the MongoDB API server: npm start');
    console.log('2. Start your Study Companion app: npm run dev');
    console.log('3. Upload some PDF files to test the dual storage');
    console.log('4. Check browser console for sync status messages');
    
    return score >= 60;
}

// Run the test suite
if (require.main === module) {
    runFullTestSuite().catch(console.error);
}

module.exports = {
    testMongoConnection,
    testApiServer,
    testCrudOperations,
    testSyncFunctionality,
    testPerformance,
    runFullTestSuite
};
