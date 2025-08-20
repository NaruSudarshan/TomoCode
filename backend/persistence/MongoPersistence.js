// persistence/MongoPersistence.js
const Y = require('yjs');

class MongoPersistence {
  constructor(connection, options = {}) {
    this.connection = connection;
    this.collectionName = options.collectionName || 'yjsDocuments';
    this.collection = connection.collection(this.collectionName);
    this.boundDocs = new Map();
  }

  async bindState(documentName, ydoc) {
    // Store reference to bound document
    this.boundDocs.set(documentName, ydoc);
    
    // Get the current state from database
    const storedState = await this.getState(documentName);
    if (storedState) {
      Y.applyUpdate(ydoc, storedState);
    }
    
    // Store updates to MongoDB
    ydoc.on('update', async (update) => {
      await this.storeUpdate(documentName, update);
    });
  }

  async getState(documentName) {
    const doc = await this.collection.findOne({ _id: documentName });
    return doc ? Buffer.from(doc.state.buffer) : null;
  }

  async storeUpdate(documentName, update) {
    try {
      // Get current state or create new document
      const currentDoc = await this.collection.findOne({ _id: documentName });
      
      if (currentDoc) {
        // Apply update to existing state
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, Buffer.from(currentDoc.state.buffer));
        Y.applyUpdate(ydoc, update);
        const newState = Y.encodeStateAsUpdate(ydoc);
        
        // Update the document
        await this.collection.updateOne(
          { _id: documentName },
          { $set: { state: newState, lastModified: new Date() } }
        );
      } else {
        // Create new document with initial state
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, update);
        const newState = Y.encodeStateAsUpdate(ydoc);
        
        await this.collection.insertOne({
          _id: documentName,
          state: newState,
          lastModified: new Date()
        });
      }
    } catch (error) {
      console.error('Error storing update:', error);
    }
  }

  async getYDoc(documentName) {
    const state = await this.getState(documentName);
    if (!state) return null;
    
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state);
    return ydoc;
  }

  // Additional method to clear a document
  async clearDocument(documentName) {
    await this.collection.deleteOne({ _id: documentName });
    this.boundDocs.delete(documentName);
  }
}

module.exports = { MongoPersistence };