import express from 'express';
import cors from 'cors';
import clipRoutes from './routes/clips.js';
import profileRoutes from './routes/profiles.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/clips', clipRoutes);
app.use('/api/profiles', profileRoutes);

// Health check endpoint
app.get('/', (req, res) => {
  res.send('MyLyfe Backend is running!');
});

// Global error handler (simple version)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

export default app;
