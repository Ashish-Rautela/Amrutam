import express from 'express';

export const app = express();

app.use(express.json());

// Application routes and middleware will be mounted here
