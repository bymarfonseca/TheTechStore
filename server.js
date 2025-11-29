// ==========================================================
// CONFIGURACIÓN E INICIALIZACIÓN DEL SERVIDOR Y LA BASE DE DATOS
// ==========================================================
const express = require('express');
const mysql = require('mysql2'); 
const session = require('express-session');
const bcrypt = require('bcrypt');
const cors = require('cors'); // Para permitir la conexión desde Apache (XAMPP)
const app = express();
const PORT = 3000;

// Configuración de la Base de Datos (VERIFICAR usuario/contraseña)
const dbConfig = {
    host: 'localhost', 
    user: 'root',
    password: '', 
    database: 'tienda_online_modificada',
    // Configuración del Pool de Conexiones para mayor estabilidad
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// ** USAMOS EL POOL DE CONEXIONES **
const db = mysql.createPool(dbConfig);

// Verificar la conexión inicial a la BD
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error fatal al conectar/iniciar el Pool de Conexiones:', err);
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
    origin: 'http://localhost', // Tu frontend está aquí
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true 
}));

// 1. Procesamiento de datos de la petición (JSON y formularios)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Manejo de Sesiones
app.use(session({
    secret: 'UNA_CLAVE_SECRETA_MUY_LARGA_Y_COMPLEJA_PARA_SEGURIDAD', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24, secure: false } 
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
                isLoggedIn: true,
                user: { id: user.id_usuario, nombre: user.nombre, email: user.email }
            });
        } else {
            res.status(401).json({ error: 'Credenciales inválidas.' }); 
        }
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        res.json({ 
            isLoggedIn: true, 
            userId: req.session.userId, 
            nombre: req.session.nombre 
        });
    } else {
        res.json({ isLoggedIn: false });
    }
});

// ==========================================================
// RUTAS DE PRODUCTOS Y FILTRADO (INCLUYENDO BUSCADOR)
// ==========================================================

/**
 * Endpoint para obtener productos con filtros (categoría, precio, ordenamiento Y BÚSQUEDA)
 */
app.get('/api/productos/filtrar', (req, res) => {
    // Captura el parámetro 'busqueda'
    const { categoria, precio_min, precio_max, orden, busqueda } = req.query; 

    let sql = `
        SELECT p.*, c.nombre AS nombre_categoria
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        WHERE 1=1 
    `;
    let params = [];

    // 0. LÓGICA DE BÚSQUEDA (OPERADOR LIKE)
    if (busqueda) {
        // Usa LIKE para buscar el término en nombre O descripción
        sql += ' AND (p.nombre LIKE ? OR p.descripcion LIKE ?)';
        const terminoBusqueda = '%' + busqueda + '%';
        params.push(terminoBusqueda, terminoBusqueda);
    }

    // 1. Filtro por Categoría
    if (categoria && categoria !== 'todos') {
        sql += ' AND p.id_categoria = ?';
        params.push(categoria);
    }

    // 2. Filtro por Precio Mínimo/Máximo
    if (precio_min && !isNaN(parseFloat(precio_min))) {
        sql += ' AND p.precio >= ?';
        params.push(parseFloat(precio_min));
    }
    if (precio_max && !isNaN(parseFloat(precio_max))) {
        sql += ' AND p.precio <= ?';
        params.push(parseFloat(precio_max));
    }

    // 3. Ordenamiento
    if (orden === 'asc') {
        sql += ' ORDER BY p.precio ASC';
    } else if (orden === 'desc') {
        sql += ' ORDER BY p.precio DESC';
    } else {
        sql += ' ORDER BY p.nombre ASC'; 
    }

    // Ejecutar la consulta
    db.execute(sql, params, (err, results) => {
        if (err) {
            console.error('Error al filtrar productos (SQL FAILED):', err);
            return res.status(500).json({ error: 'Error interno del servidor al obtener productos.' });
        }
        res.json(results);
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

// ==========================================================
// INICIAR EL SERVIDOR
// ==========================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js corriendo en http://localhost:${PORT}`);
});