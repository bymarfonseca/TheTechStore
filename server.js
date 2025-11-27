// server.js
const express = require('express');
const app = express();
const dotenv = require('dotenv');

const authRoutes = require('./authRoutes');
const productRoutes = require('./productRoutes');
const cartRoutes = require('./cartRoutes');

dotenv.config();

const PORT = process.env.PORT || 3000;


app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});


app.use(express.json());



// Rutas de Autenticación, Registro y Perfil
app.use('/api/auth', authRoutes);

// Rutas de Catálogo y Producto Individual
app.use('/api/products', productRoutes);

// Rutas de Carrito y Pedido (Checkout)
app.use('/api/cart', cartRoutes);


// Ruta de prueba
app.get('/', (req, res) => {
    res.send('Servidor de The Tech Store en funcionamiento.');
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});