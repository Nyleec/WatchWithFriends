const { MongoClient } = require('mongodb');

let usersCollection = null;

function log(...args){
  console.log(new Date().toISOString(), ...args);
}

async function initDb(){
  if(process.env.MONGO_URI){
    try{
      const client = new MongoClient(process.env.MONGO_URI);
      await client.connect();
      const dbName = process.env.MONGO_DB || 'watchwithfriends';
      usersCollection = client.db(dbName).collection('users');
      log('Connected to MongoDB', dbName);
    }catch(e){
      log('Failed to connect to MongoDB, auth endpoints will fail:', e.message);
    }
  } else {
    log('No MONGO_URI set; registration/login disabled');
  }
}

function getUsersCollection(){
  return usersCollection;
}

module.exports = {
  initDb,
  getUsersCollection,
};
