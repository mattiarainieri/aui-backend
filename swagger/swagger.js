const swaggerAutogen = require('swagger-autogen')();

const outputFile = './swagger_output.json';
const endpointsFiles = ['../index.js']; // Your main entry file

swaggerAutogen(outputFile, endpointsFiles).then(() => {});