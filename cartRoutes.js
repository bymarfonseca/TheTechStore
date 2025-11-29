// cartRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('./db');
const authMiddleware = require('./authMiddleware');

router.use(authMiddleware); 


router.post('/add', async (req, res) => {
    const { id_producto, cantidad } = req.body;
    const id_usuario = req.user.id_usuario;

    if (!id_producto || !cantidad || cantidad <= 0) {
        return res.status(400).json({ msg: 'Producto y cantidad válidos son requeridos.' });
    }

    try {
        // 1. Buscar si el producto ya existe en el carrito del usuario
        const [existingItem] = await pool.query(
            'SELECT id_carrito, total_carrito FROM carrito WHERE id_usuario = ? AND id_productos = ?',
            [id_usuario, id_producto]
        );

        if (existingItem.length > 0) {
            // 2. Si existe: Actualizar la cantidad
            const newCantidad = existingItem[0].total_carrito + cantidad;
            await pool.query(
                'UPDATE carrito SET total_carrito = ? WHERE id_carrito = ?',
                [newCantidad, existingItem[0].id_carrito]
            );
            res.json({ msg: 'Cantidad del producto actualizada en el carrito.' });
        } else {
            // 3. Si no existe: Insertar nuevo registro
            await pool.query(
                'INSERT INTO carrito (id_usuario, id_productos, total_carrito, fecha_carrito) VALUES (?, ?, ?, CURDATE())',
                [id_usuario, id_producto, cantidad]
            );
            res.json({ msg: 'Producto agregado al carrito.' });
        }
    } catch (err) {
        console.error('Error al añadir al carrito:', err);
        res.status(500).send('Error del servidor');
    }
});


router.get('/', async (req, res) => {
    const id_usuario = req.user.id_usuario;

    try {
       
        const query = `
            SELECT 
                c.id_carrito, 
                c.total_carrito AS cantidad, 
                p.nombre_producto, 
                p.precio_producto,
                (c.total_carrito * p.precio_producto) AS subtotal
            FROM carrito c
            JOIN productos p ON c.id_productos = p.id_producto
            WHERE c.id_usuario = ?
        `;
        const [items] = await pool.query(query, [id_usuario]);
        
        const total = items.reduce((sum, item) => sum + item.subtotal, 0);

        res.json({
            items: items,
            total_global: total
        });
    } catch (err) {
        console.error('Error al obtener carrito:', err);
        res.status(500).send('Error del servidor');
    }
});


router.delete('/remove/:id_carrito', async (req, res) => {
    const id_carrito = req.params.id_carrito;
    const id_usuario = req.user.id_usuario;

    try {
       
        const [result] = await pool.query(
            'DELETE FROM carrito WHERE id_carrito = ? AND id_usuario = ?',
            [id_carrito, id_usuario]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ msg: 'Artículo no encontrado o no pertenece al usuario.' });
        }

        res.json({ msg: 'Artículo eliminado del carrito exitosamente.' });
    } catch (err) {
        console.error('Error al eliminar del carrito:', err);
        res.status(500).send('Error del servidor');
    }
});


router.post('/checkout', async (req, res) => {
    const { calle_direccion, estado_direccion, cp_direccion, metodopago_pedido } = req.body;
    const id_usuario = req.user.id_usuario;

    let connection;
    try {
     
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Verificar y obtener productos del carrito
        const [cartItems] = await connection.query(
            'SELECT id_productos, total_carrito AS cantidad, p.precio_producto FROM carrito c JOIN productos p ON c.id_productos = p.id_producto WHERE c.id_usuario = ?', 
            [id_usuario]
        );

        if (cartItems.length === 0) {
            await connection.rollback();
            return res.status(400).json({ msg: 'El carrito está vacío.' });
        }

        // 2. Registrar la Dirección 
        const [dirResult] = await connection.query(
            'INSERT INTO direccion (id_usuario, calle_direccion, estado_direccion, cp_direccion) VALUES (?, ?, ?, ?)',
            [id_usuario, calle_direccion, estado_direccion, cp_direccion]
        );
        const id_direccion = dirResult.insertId;

        // 3. Crear el Pedido
        const [pedidoResult] = await connection.query(
            'INSERT INTO pedido (id_usuario, fecha_pedido, estado_pedido, id_direccion, metodopago_pedido) VALUES (?, CURDATE(), ?, ?, ?)',
            [id_usuario, 'Pendiente', id_direccion, metodopago_pedido]
        );
        const id_pedido = pedidoResult.insertId; 

        // 4. Mover artículos del carrito a detalle de pedido 
        const detailPromises = cartItems.map(item => {
            const total_det_pp = item.cantidad * item.precio_producto;
            return connection.query(
                'INSERT INTO det_pp (id_producto, id_pedido, cantidad_det_pp, total_det_pp) VALUES (?, ?, ?, ?)',
                [item.id_productos, id_pedido, item.cantidad, total_det_pp]
            );
        });

        await Promise.all(detailPromises);

        // 5. Vaciar el Carrito del usuario
        await connection.query('DELETE FROM carrito WHERE id_usuario = ?', [id_usuario]);

        // 6. Confirmar la Transacción
        await connection.commit();
        connection.release();

        res.json({ 
            msg: 'Pedido realizado exitosamente.', 
            id_pedido: id_pedido // Devuelve el número de pedido
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error('Error al realizar el pedido (Checkout):', err);
        res.status(500).send('Error del servidor al procesar el pedido.');
    }
});

module.exports = router;