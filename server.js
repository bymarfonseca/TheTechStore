// ==========================================================
// CONFIGURACIÓN E INICIALIZACIÓN DEL SERVIDOR Y LA BASE DE DATOS
// ==========================================================
const express = require('express');
const mysql = require('mysql2'); 
const session = require('express-session');
const bcrypt = require('bcrypt');
const app = express();
const PORT = 3000;

// Configuración de la Base de Datos (AJUSTA ESTOS VALORES si son diferentes a root/vacío)
const dbConfig = {
    host: 'localhost', 
    user: 'root',
    password: '', 
    database: 'tienda_online_modificada',
    // Configuración del Pool de Conexiones
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// ** USAMOS EL POOL DE CONEXIONES para mayor estabilidad **
const db = mysql.createPool(dbConfig);

// Conectar a la BD (El pool verifica la conexión automáticamente)
db.getConnection((err, connection) => {
    if (err) {
        // Manejo de errores en caso de fallo crítico al iniciar la BD
        console.error('❌ Error fatal al conectar/iniciar el Pool de Conexiones:', err);
        process.exit(1); 
    }
    if (connection) connection.release(); // Libera la conexión inicial de prueba
    
    console.log('✅ Conexión exitosa a la base de datos MySQL (Pool iniciado).');
});

// ==========================================================
// MIDDLEWARE
// ==========================================================
const cors = require('cors'); // <-- AGREGAR ESTO AL INICIO DE server.js

// 0. Configuración CORS (¡CRUCIAL!)
app.use(cors({
    origin: 'http://localhost', // Permite solicitudes desde Apache (puerto 80)
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true // Permite el envío de cookies de sesión
}));

// 1. Procesamiento de datos de la petición (JSON y formularios)
app.use(express.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Manejo de Sesiones
app.use(session({
    secret: 'UNA_CLAVE_SECRETA_MUY_LARGA_Y_COMPLEJA_PARA_SEGURIDAD', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 horas
}));

// Middleware para verificar si el usuario está logueado
const checkAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'No autorizado. Debe iniciar sesión.' });
    }
};

// ==========================================================
// RUTAS DE AUTENTICACIÓN (LOGIN Y REGISTRO)
// ==========================================================

app.post('/api/register', async (req, res) => {
    const { nombre, email, password, telefono } = req.body;
    if (!nombre || !email || !password) {
        return res.status(400).json({ error: 'Faltan campos requeridos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO usuarios (nombre, email, password, telefono) VALUES (?, ?, ?, ?)';
        
        db.execute(sql, [nombre, email, hashedPassword, telefono], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ error: 'El email ya está registrado.' });
                }
                console.error('Error al registrar usuario:', err);
                return res.status(500).json({ error: 'Error interno del servidor.' });
            }
            res.status(201).json({ message: 'Registro exitoso.', userId: result.insertId });
        });
    } catch (error) {
        console.error('Error durante el hasheo:', error);
        res.status(500).json({ error: 'Error interno de seguridad.' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Faltan email o contraseña.' });
    }

    const sql = 'SELECT id_usuario, nombre, email, password FROM usuarios WHERE email = ?';
    
    db.execute(sql, [email], async (err, results) => {
        if (err || results.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }
        const user = results[0];
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (passwordMatch) {
            req.session.userId = user.id_usuario;
            req.session.nombre = user.nombre;
            req.session.email = user.email;
            
            res.json({ 
                message: 'Inicio de sesión exitoso.', 
                user: { id: user.id_usuario, nombre: user.nombre, email: user.email }
            });
        } else {
            res.status(401).json({ error: 'Credenciales inválidas.' });
        }
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'No se pudo cerrar la sesión.' });
        }
        res.clearCookie('connect.sid');
        res.json({ message: 'Sesión cerrada exitosamente.' });
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        res.json({ 
            isLoggedIn: true, 
            nombre: req.session.nombre,
        });
    } else {
        res.json({ isLoggedIn: false });
    }
});


// ==========================================================
// RUTAS DE CATÁLOGO (FILTRADO Y CATEGORÍAS)
// ==========================================================

app.get('/api/productos/filtrar', (req, res) => {
    const { categoria, precio_min, precio_max, orden } = req.query;

    let sql = `
        SELECT p.*, c.nombre AS nombre_categoria
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        WHERE 1=1 
    `;
    let params = [];

    // 1. Filtro por Categoría (usa id_categoria)
    if (categoria && categoria !== 'todos') {
        sql += ' AND p.id_categoria = ?';
        params.push(categoria);
    }

    // 2. Filtro por Precio Mínimo
    if (precio_min && !isNaN(parseFloat(precio_min))) {
        sql += ' AND p.precio >= ?';
        params.push(parseFloat(precio_min));
    }

    // 3. Filtro por Precio Máximo
    if (precio_max && !isNaN(parseFloat(precio_max))) {
        sql += ' AND p.precio <= ?';
        params.push(parseFloat(precio_max));
    }

    // 4. Ordenamiento
    if (orden === 'asc') {
        sql += ' ORDER BY p.precio ASC';
    } else if (orden === 'desc') {
        sql += ' ORDER BY p.precio DESC';
    } else {
        sql += ' ORDER BY p.nombre ASC'; 
    }

    db.execute(sql, params, (err, results) => {
        if (err) {
            console.error('Error al filtrar productos (SQL FAILED):', err);
            // Este es el mensaje que aparece en el navegador cuando falla la consulta
            return res.status(500).json({ error: 'Error interno del servidor al obtener productos.' });
        }
        res.json(results);
    });
});

app.get('/api/productos/:id', (req, res) => {
    const productId = req.params.id;
    
    const sql = `
        SELECT p.*, c.nombre AS nombre_categoria
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        WHERE p.id_producto = ?
    `;

    db.execute(sql, [productId], (err, results) => {
        if (err) {
            console.error('Error al obtener producto individual:', err);
            return res.status(500).json({ error: 'Error interno del servidor.' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado.' });
        }
        res.json(results[0]);
    });
});


// ==========================================================
// RUTAS DE CARRITO Y PEDIDOS (PROTEGIDAS por checkAuth)
// ==========================================================

const getOrCreateCarritoId = (userId, callback) => {
    let sql = 'SELECT id_carrito FROM carrito WHERE id_usuario = ?';
    db.execute(sql, [userId], (err, results) => {
        if (err) return callback(err);

        if (results.length > 0) {
            return callback(null, results[0].id_carrito);
        } else {
            sql = 'INSERT INTO carrito (id_usuario) VALUES (?)';
            db.execute(sql, [userId], (err, result) => {
                if (err) return callback(err);
                callback(null, result.insertId);
            });
        }
    });
};

app.post('/api/carrito/agregar', checkAuth, (req, res) => {
    const userId = req.session.userId;
    const { id_producto, cantidad } = req.body;
    
    if (!id_producto || !cantidad || cantidad <= 0) {
        return res.status(400).json({ error: 'Datos de producto inválidos.' });
    }

    getOrCreateCarritoId(userId, (err, id_carrito) => {
        if (err) return res.status(500).json({ error: 'Error de servidor.' });

        let sql = 'SELECT cantidad FROM detalles_carrito WHERE id_carrito = ? AND id_producto = ?';
        db.execute(sql, [id_carrito, id_producto], (err, results) => {
            if (err) return res.status(500).json({ error: 'Error de servidor.' });

            if (results.length > 0) {
                const nuevaCantidad = results[0].cantidad + cantidad;
                sql = 'UPDATE detalles_carrito SET cantidad = ? WHERE id_carrito = ? AND id_producto = ?';
                db.execute(sql, [nuevaCantidad, id_carrito, id_producto], (updateErr) => {
                    if (updateErr) return res.status(500).json({ error: 'Error al actualizar el carrito.' });
                    res.json({ message: 'Cantidad de producto actualizada en el carrito.' });
                });
            } else {
                sql = 'INSERT INTO detalles_carrito (id_carrito, id_producto, cantidad) VALUES (?, ?, ?)';
                db.execute(sql, [id_carrito, id_producto, cantidad], (insertErr) => {
                    if (insertErr) return res.status(500).json({ error: 'Error al agregar producto al carrito.' });
                    res.json({ message: 'Producto agregado al carrito.' });
                });
            }
        });
    });
});

app.post('/api/carrito/eliminar', checkAuth, (req, res) => {
    const userId = req.session.userId;
    const { id_producto } = req.body;

    getOrCreateCarritoId(userId, (err, id_carrito) => {
        if (err) return res.status(500).json({ error: 'Error de servidor.' });

        const sql = 'DELETE FROM detalles_carrito WHERE id_carrito = ? AND id_producto = ?';
        db.execute(sql, [id_carrito, id_producto], (deleteErr, result) => {
            if (deleteErr) return res.status(500).json({ error: 'Error al eliminar producto del carrito.' });
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Producto no encontrado en el carrito.' });
            res.json({ message: 'Producto eliminado del carrito.' });
        });
    });
});

app.get('/api/carrito', checkAuth, (req, res) => {
    const userId = req.session.userId;

    const sql = `
        SELECT 
            dc.id_detalle_carrito, dc.cantidad, p.id_producto, p.nombre, p.precio, (p.precio * dc.cantidad) AS subtotal
        FROM carrito c
        JOIN detalles_carrito dc ON c.id_carrito = dc.id_carrito
        JOIN productos p ON dc.id_producto = p.id_producto
        WHERE c.id_usuario = ?
    `;

    db.execute(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error interno del servidor.' });
        const total = results.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2);
        res.json({ items: results, total: total });
    });
});

app.post('/api/pedidos/checkout', checkAuth, async (req, res) => {
    const userId = req.session.userId;
    const { calle, ciudad, estado, codigo_postal, metodo_pago } = req.body;

    if (!calle || !ciudad || !codigo_postal || !metodo_pago) {
        return res.status(400).json({ error: 'Faltan datos de envío o método de pago.' });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig).promise();
        await connection.beginTransaction();

        let [carritoResults] = await connection.execute(
            'SELECT dc.id_producto, dc.cantidad, p.precio, p.stock FROM carrito c JOIN detalles_carrito dc ON c.id_carrito = dc.id_carrito JOIN productos p ON dc.id_producto = p.id_producto WHERE c.id_usuario = ?',
            [userId]
        );

        if (carritoResults.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'El carrito está vacío.' });
        }
        
        let totalPedido = 0;
        const detalles = carritoResults;

        for (const item of detalles) {
            if (item.cantidad > item.stock) {
                await connection.rollback();
                return res.status(400).json({ error: `Stock insuficiente para producto ID ${item.id_producto}. Solo hay ${item.stock} disponibles.` });
            }
            totalPedido += item.precio * item.cantidad;
        }

        const [direccionCheck] = await connection.execute('SELECT id_direccion FROM direcciones WHERE id_usuario = ?', [userId]);
        let id_direccion_envio;

        if (direccionCheck.length > 0) {
            id_direccion_envio = direccionCheck[0].id_direccion;
            await connection.execute(
                'UPDATE direcciones SET calle = ?, ciudad = ?, estado = ?, codigo_postal = ? WHERE id_usuario = ?',
                [calle, ciudad, estado, codigo_postal, userId]
            );
        } else {
            const [direccionInsert] = await connection.execute(
                'INSERT INTO direcciones (id_usuario, calle, ciudad, estado, codigo_postal) VALUES (?, ?, ?, ?, ?)',
                [userId, calle, ciudad, estado, codigo_postal]
            );
            id_direccion_envio = direccionInsert.insertId;
        }

        const [pedidoInsert] = await connection.execute(
            'INSERT INTO pedidos (id_usuario, total, estado, id_direccion_envio, metodo_pago) VALUES (?, ?, ?, ?, ?)',
            [userId, totalPedido.toFixed(2), 'PAGADO', id_direccion_envio, metodo_pago]
        );
        const id_pedido = pedidoInsert.insertId;

        for (const item of detalles) {
            await connection.execute(
                'INSERT INTO detalles_pedido (id_pedido, id_producto, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
                [id_pedido, item.id_producto, item.cantidad, item.precio]
            );

            await connection.execute(
                'UPDATE productos SET stock = stock - ? WHERE id_producto = ?',
                [item.cantidad, item.id_producto]
            );
        }

        await connection.execute('DELETE FROM detalles_carrito WHERE id_carrito IN (SELECT id_carrito FROM carrito WHERE id_usuario = ?)', [userId]);
        
        await connection.commit();
        
        res.json({ message: 'Pedido realizado con éxito.', id_pedido: id_pedido, total: totalPedido.toFixed(2) });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error durante el checkout/transacción:', error);
        res.status(500).json({ error: 'Error al procesar el pedido. La transacción fue revertida.' });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});


// ==========================================================
// INICIAR EL SERVIDOR
// ==========================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js corriendo en http://localhost:${PORT}`);
});