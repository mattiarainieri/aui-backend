const swaggerAutogen = require('swagger-autogen')();

const outputFile = './swagger_output.json';
const endpointsFiles = ['../index.js',
                                '../routes/*.js',
                                '../routes/*/*'];

swaggerAutogen(outputFile, endpointsFiles).then(() => {});