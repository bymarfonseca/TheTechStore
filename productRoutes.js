// productRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('./db');


router.get('/', async (req, res) => {
    
    const { category, minPrice, maxPrice, sort } = req.query;

    let query = `
        SELECT p.*, c.nombre_categoria 
        FROM productos p
        JOIN categoria c ON p.id_categoria = c.id_categoria
        WHERE 1=1 
    `;
    const params = [];

  
    if (category) {
        query += ' AND c.nombre_categoria = ?';
        params.push(category);
    }
    
    // Filtrar por Rango de Precios
    if (minPrice && maxPrice) {
        query += ' AND p.precio_producto BETWEEN ? AND ?';
        params.push(minPrice, maxPrice);
    } else if (minPrice) {
        query += ' AND p.precio_producto >= ?';
        params.push(minPrice);
    } else if (maxPrice) {
        query += ' AND p.precio_producto <= ?';
        params.push(maxPrice);
    }


    if (sort === 'price_asc') {
        query += ' ORDER BY p.precio_producto ASC';
    } else if (sort === 'price_desc') {
        query += ' ORDER BY p.precio_producto DESC';
    } else {
        query += ' ORDER BY p.id_producto DESC';
    }

    try {
        const [products] = await pool.query(query, params);
        res.json(products);
    } catch (err) {
        console.error('Error al obtener catálogo:', err);
        res.status(500).send('Error del servidor');
    }
});


router.get('/:id', async (req, res) => {
    const id_producto = req.params.id;

    try {
        const query = `
            SELECT p.*, c.nombre_categoria 
            FROM productos p
            JOIN categoria c ON p.id_categoria = c.id_categoria
            WHERE p.id_producto = ?
        `;
        const [rows] = await pool.query(query, [id_producto]);

        if (rows.length === 0) {
            return res.status(404).json({ msg: 'Producto no encontrado.' });
        }

        const product = rows[0];
        
        // Incluye la categoría del producto
        res.json({
            ...product,
            categoria_texto: `Categoría: ${product.nombre_categoria}` 
        });

    } catch (err) {
        console.error('Error al obtener producto individual:', err);
        res.status(500).send('Error del servidor');
    }
});

module.exports = router;