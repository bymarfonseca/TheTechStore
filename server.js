// ==========================================================
// CONFIGURACIÓN E INICIALIZACIÓN DEL SERVIDOR Y LA BASE DE DATOS
// ==========================================================
const express = require('express');
const mysql = require('mysql2'); 
const session = require('express-session');
const bcrypt = require('bcrypt');
const cors = require('cors'); 
const app = express();
const PORT = 3000;

// CRUCIAL: Confía en los encabezados Host/Origin
app.set('trust proxy', 1); 

// Configuración de la Base de Datos
const dbConfig = {
    host: 'localhost', 
    user: 'root',
    password: '', 
    database: 'tienda_online_modificada',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// ** USAMOS EL POOL DE CONEXIONES **
const db = mysql.createPool(dbConfig);
const poolPromise = db.promise(); // Interfaz de Promesas para transacciones

// Verificar la conexión inicial a la BD
db.getConnection((err, connection) => {
    if (err) {
        console.error('Error fatal al conectar/iniciar el Pool de Conexiones:', err);
        process.exit(1); 
    }
    if (connection) connection.release();
    console.log('✅ Conexión exitosa a la base de datos MySQL (Pool iniciado).');
});

// ==========================================================
// MIDDLEWARE
// ==========================================================

// 0. Configuración CORS
app.use(cors({
    origin: 'http://localhost', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true 
}));

// 1. Procesamiento de datos
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Manejo de Sesiones
app.use(session({
    secret: 'UNA_CLAVE_SECRETA_MUY_LARGA_Y_COMPLEJA_PARA_SEGURIDAD', 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24, 
        secure: false, 
        sameSite: 'Lax' 
    } 
}));

// Middleware para verificar si el usuario está logueado
const checkAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'No autorizado. Debe iniciar sesión.' });
    }
};

// Middleware para verificar si el usuario es ADMINISTRADOR
const checkAdmin = (req, res, next) => {
    if (req.session.userId && req.session.rol === 'admin') { 
        next();
    } else {
        res.status(403).json({ error: 'Acceso denegado. Se requiere ser administrador.' });
    }
};

// ==========================================================
// RUTAS DE AUTENTICACIÓN (LOGIN, REGISTRO, SESIÓN Y LOGOUT)
// ==========================================================

// RUTA DE REGISTRO DE CLIENTES NORMALES
app.post('/api/register', async (req, res) => {
    const { nombre, email, password, telefono } = req.body;
    if (!nombre || !email || !password) {
        return res.status(400).json({ error: 'Faltan campos requeridos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO usuarios (nombre, email, password, telefono, rol) VALUES (?, ?, ?, ?, "cliente")';
        
        db.execute(sql, [nombre, email, hashedPassword, telefono], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ error: 'El email ya está registrado.' });
                }
                console.error('Error al registrar cliente:', err);
                return res.status(500).json({ error: 'Error interno del servidor.' });
            }
            res.status(201).json({ message: 'Registro exitoso.', userId: result.insertId });
        });
    } catch (error) {
        console.error('Error durante el hasheo:', error);
        res.status(500).json({ error: 'Error interno de seguridad.' });
    }
});

// RUTA DE LOGIN
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Faltan email o contraseña.' });
    }

    const sql = 'SELECT id_usuario, nombre, email, password, rol FROM usuarios WHERE email = ?';
    
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
            req.session.rol = user.rol; 
            
            res.json({ 
                message: 'Inicio de sesión exitoso.', 
                isLoggedIn: true,
                user: { id: user.id_usuario, nombre: user.nombre, email: user.email, rol: user.rol } 
            });
        } else {
            res.status(401).json({ error: 'Credenciales inválidas.' }); 
        }
    });
});

// RUTA PARA OBTENER LA SESIÓN
app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        res.json({ 
            isLoggedIn: true, 
            userId: req.session.userId, 
            nombre: req.session.nombre,
            rol: req.session.rol
        });
    } else {
        res.json({ isLoggedIn: false });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión.' });
        }
        res.clearCookie('connect.sid'); 
        res.json({ message: 'Sesión cerrada exitosamente.' });
    });
});

// ==========================================================
// RUTAS DE PRODUCTOS Y FILTRADO (CLIENTE)
// ==========================================================

// 🛑 1. RUTA CRUCIAL PARA EL CATÁLOGO (MÁS ESPECÍFICA) 🛑
app.get('/api/productos/filtrar', (req, res) => {
    const { categoria, precio_min, precio_max, orden, busqueda } = req.query; 

    let sql = `
        SELECT p.*, c.nombre AS nombre_categoria
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        WHERE 1=1 
    `;
    let params = [];
    
    if (busqueda) {
        sql += ' AND (p.nombre LIKE ? OR p.descripcion LIKE ?)';
        const terminoBusqueda = '%' + busqueda + '%';
        params.push(terminoBusqueda, terminoBusqueda);
    }
    if (categoria && categoria !== 'todos') {
        sql += ' AND p.id_categoria = ?';
        params.push(categoria);
    }
    
    // Fix de ordenamiento numérico
    if (orden === 'asc') {
        sql += ' ORDER BY CAST(p.precio AS DECIMAL(10, 2)) ASC';
    } else if (orden === 'desc') {
        sql += ' ORDER BY CAST(p.precio AS DECIMAL(10, 2)) DESC';
    } else {
        sql += ' ORDER BY p.nombre ASC'; 
    }

    db.execute(sql, params, (err, results) => {
        if (err) {
            console.error('Error al filtrar productos (SQL FAILED):', err);
            return res.status(500).json({ error: 'Error interno del servidor al obtener productos.' });
        }
        res.json(results);
    });
});


// 🛑 2. RUTA PARA OBTENER UN SOLO PRODUCTO POR ID (MÁS GENÉRICA) 🛑
// DEBE IR DESPUÉS DE /api/productos/filtrar
app.get('/api/productos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const sql = 'SELECT * FROM productos WHERE id_producto = ?';
        const [results] = await poolPromise.execute(sql, [id]);

        if (results.length === 0) {
            return res.status(404).json({ error: `Producto con ID ${id} no encontrado en la base de datos.` });
        }
        res.json(results[0]);
    } catch (error) {
        console.error('Error al obtener producto por ID:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// 🛑 RUTA CRUCIAL PARA EL CATÁLOGO 🛑
app.get('/api/productos/filtrar', (req, res) => {
    const { categoria, precio_min, precio_max, orden, busqueda } = req.query; 

    let sql = `
        SELECT p.*, c.nombre AS nombre_categoria
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        WHERE 1=1 
    `;
    let params = [];
    
    if (busqueda) {
        sql += ' AND (p.nombre LIKE ? OR p.descripcion LIKE ?)';
        const terminoBusqueda = '%' + busqueda + '%';
        params.push(terminoBusqueda, terminoBusqueda);
    }
    if (categoria && categoria !== 'todos') {
        sql += ' AND p.id_categoria = ?';
        params.push(categoria);
    }
    
    // Fix de ordenamiento numérico
    if (orden === 'asc') {
        sql += ' ORDER BY CAST(p.precio AS DECIMAL(10, 2)) ASC';
    } else if (orden === 'desc') {
        sql += ' ORDER BY CAST(p.precio AS DECIMAL(10, 2)) DESC';
    } else {
        sql += ' ORDER BY p.nombre ASC'; 
    }

    db.execute(sql, params, (err, results) => {
        if (err) {
            console.error('Error al filtrar productos (SQL FAILED):', err);
            return res.status(500).json({ error: 'Error interno del servidor al obtener productos.' });
        }
        res.json(results);
    });
});

// ==========================================================
// RUTAS DE CARRITO Y PEDIDOS (CLIENTE)
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

app.post('/api/carrito/eliminar/:id_producto', checkAuth, (req, res) => {
    const userId = req.session.userId;
    const id_producto = req.params.id_producto; 

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
            dc.id_detalle_carrito, dc.cantidad, 
            p.id_producto, p.nombre, p.precio, p.imagen, 
            (p.precio * dc.cantidad) AS subtotal
        FROM carrito c
        JOIN detalles_carrito dc ON c.id_carrito = dc.id_carrito
        JOIN productos p ON dc.id_producto = p.id_producto
        WHERE c.id_usuario = ?
    `;

    db.execute(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error interno del servidor.' });
        
        const rawTotal = results.reduce((sum, item) => sum + parseFloat(item.subtotal), 0);
        const totalFormateado = rawTotal.toFixed(2);

        res.json({ items: results, total: totalFormateado });
    });
});

app.post('/api/pedidos/crear', checkAuth, async (req, res) => {
    const userId = req.session.userId;
    const { direccion, estado, ciudad, cp, datos_pago } = req.body; 

    if (!direccion || !estado || !ciudad || !cp) {
        return res.status(400).json({ error: 'Faltan campos de dirección requeridos.' });
    }

    let connection;
    try {
        connection = await poolPromise.getConnection();
        await connection.beginTransaction();

        const [carritoResult] = await connection.query('SELECT id_carrito FROM carrito WHERE id_usuario = ?', [userId]);
        if (carritoResult.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'No se encontró el carrito asociado.' });
        }
        const id_carrito = carritoResult[0].id_carrito;
        
        const [carritoItems] = await connection.query(`
            SELECT 
                dc.id_producto, dc.cantidad, p.precio 
            FROM detalles_carrito dc
            JOIN productos p ON dc.id_producto = p.id_producto
            WHERE dc.id_carrito = ?
        `, [id_carrito]);
        
        if (carritoItems.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'El carrito está vacío. Agregue productos para realizar un pedido.' });
        }

        const total = carritoItems.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
        
        const [resultadoPedido] = await connection.query(`
            INSERT INTO pedidos (id_usuario, fecha, total, direccion, estado_pedido, ciudad, cp)
            VALUES (?, NOW(), ?, ?, ?, ?, ?)
        `, [userId, total, direccion, estado, ciudad, cp]);

        const id_pedido = resultadoPedido.insertId;

        const detalles = carritoItems.map(item => [
            id_pedido, 
            item.id_producto, 
            item.cantidad, 
            item.precio
        ]);
        
        await connection.query(
            'INSERT INTO detalles_pedido (id_pedido, id_producto, cantidad, precio_unitario) VALUES ?',
            [detalles]
        );

        await connection.query('DELETE FROM detalles_carrito WHERE id_carrito = ?', [id_carrito]);

        await connection.commit();
        
        res.status(201).json({ 
            message: 'Pedido realizado con éxito.', 
            id_pedido: id_pedido,
            total: total.toFixed(2)
        });

    } catch (error) {
        if (connection) {
            await connection.rollback(); 
        }
        console.error('Error al crear pedido (Transacción fallida):', error);
        res.status(500).json({ error: 'Error al procesar el pedido.' });
    } finally {
        if (connection) connection.release(); 
    }
});


// ==========================================================
// INICIAR EL SERVIDOR
// ==========================================================
app.listen(PORT, () => {
    console.log(`Servidor Node.js corriendo en http://localhost:${PORT}`);
});