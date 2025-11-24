// Azure Blob Storage helper
// Exports a configured `containerClient` (or null) and the connection/config values.

const { BlobServiceClient } = require('@azure/storage-blob');

const AZURE_CONN_STR = process.env.AZURE_STORAGE_CONNECTION_STRING || null;
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'uploads';

let containerClient = null;

if (AZURE_CONN_STR) {
  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONN_STR);
    containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME);
  } catch (err) {
    console.error('lib/azure.js: Failed to create BlobServiceClient:', err);
    containerClient = null;
  }
} else {
  console.warn('lib/azure.js: AZURE_STORAGE_CONNECTION_STRING is not set. Image uploads will not work until it is provided.');
}

module.exports = {
  AZURE_CONN_STR,
  AZURE_CONTAINER_NAME,
  containerClient,
};

