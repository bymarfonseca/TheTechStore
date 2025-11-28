// ==========================================================
// CONFIGURACIÓN E INICIALIZACIÓN DEL SERVIDOR Y LA BASE DE DATOS
// ==========================================================
const express = require('express');
const mysql = require('mysql2'); // Usamos mysql2 para promesas y sentencias preparadas
const session = require('express-session');
const bcrypt = require('bcrypt'); // Para hashear y verificar contraseñas
const app = express();
const PORT = 3000;

// Configuración de la Base de Datos (AJUSTA ESTOS VALORES)
const dbConfig = {
    host: 'localhost', 
    user: 'root',
    password: '', 
    database: 'tienda_online_modificada'
};

const db = mysql.createConnection(dbConfig);

// Conectar a la BD
db.connect(err => {
    if (err) {
        console.error('❌ Error al conectar a MySQL:', err);
        process.exit(1); // Sale si no puede conectar
    }
    console.log('✅ Conexión exitosa a la base de datos MySQL.');
});

// ==========================================================
// MIDDLEWARE
// ==========================================================

// 1. Procesamiento de datos de la petición (JSON y formularios)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Manejo de Sesiones (Necesario para Login/Carrito)
app.use(session({
    secret: 'UNA_CLAVE_SECRETA_MUY_LARGA_Y_COMPLEJA_PARA_SEGURIDAD', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // Cookie expira en 24 horas
}));

// Middleware para verificar si el usuario está logueado
const checkAuth = (req, res, next) => {
    // Si la sesión contiene el ID de usuario, está logueado
    if (req.session.userId) {
        next(); // Continúa a la ruta solicitada
    } else {
        // Devuelve un error 401 (No autorizado) si no hay sesión activa
        res.status(401).json({ error: 'No autorizado. Debe iniciar sesión.' });
    }
};

// ==========================================================
// RUTAS DE AUTENTICACIÓN (LOGIN Y REGISTRO)
// ==========================================================

/**
 * Endpoint para REGISTRAR un nuevo cliente
 */
app.post('/api/register', async (req, res) => {
    const { nombre, email, password, telefono } = req.body;

    // Validación básica
    if (!nombre || !email || !password) {
        return res.status(400).json({ error: 'Faltan campos requeridos (nombre, email, password).' });
    }

    try {
        // 1. Hashear la contraseña (Seguridad)
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 2. Insertar en la tabla 'usuarios'
        const sql = 'INSERT INTO usuarios (nombre, email, password, telefono) VALUES (?, ?, ?, ?)';
        
        db.execute(sql, [nombre, email, hashedPassword, telefono], (err, result) => {
            if (err) {
                // Error 1062 es de MySQL para UNIQUE constraint (email duplicado)
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ error: 'El email ya está registrado.' });
                }
                console.error('Error al registrar usuario:', err);
                return res.status(500).json({ error: 'Error interno del servidor.' });
            }
            res.status(201).json({ 
                message: 'Registro exitoso.', 
                userId: result.insertId 
            });
        });

    } catch (error) {
        console.error('Error durante el hasheo:', error);
        res.status(500).json({ error: 'Error interno de seguridad.' });
    }
});

/**
 * Endpoint para INICIAR SESIÓN del cliente
 */
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Faltan email o contraseña.' });
    }

    // 1. Buscar usuario por email
    const sql = 'SELECT id_usuario, nombre, email, password FROM usuarios WHERE email = ?';
    
    db.execute(sql, [email], async (err, results) => {
        if (err) {
            console.error('Error de BD en login:', err);
            return res.status(500).json({ error: 'Error interno del servidor.' });
        }
        
        if (results.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        const user = results[0];

        // 2. Verificar la contraseña hasheada
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (passwordMatch) {
            // 3. Crear Sesión exitosa
            req.session.userId = user.id_usuario;
            req.session.nombre = user.nombre;
            req.session.email = user.email;
            
            // Retorna los datos básicos del usuario para el frontend
            res.json({ 
                message: 'Inicio de sesión exitoso.', 
                user: { id: user.id_usuario, nombre: user.nombre, email: user.email }
            });
        } else {
            // Contraseña incorrecta
            res.status(401).json({ error: 'Credenciales inválidas.' });
        }
    });
});

/**
 * Endpoint para CERRAR SESIÓN
 */
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'No se pudo cerrar la sesión.' });
        }
        res.clearCookie('connect.sid'); // Limpia la cookie de sesión (nombre por defecto)
        res.json({ message: 'Sesión cerrada exitosamente.' });
    });
});

/**
 * Endpoint para obtener el estado de la sesión (nombre, foto)
 */
app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        // En un proyecto real, consultarías la BD para obtener la foto.
        res.json({ 
            isLoggedIn: true, 
            nombre: req.session.nombre,
            // Aquí se podría incluir una URL de foto de perfil
        });
    } else {
        res.json({ isLoggedIn: false });
    }
});


// ==========================================================
// RUTAS DE CATÁLOGO (FILTRADO Y CATEGORÍAS)
// ==========================================================

/**
 * Endpoint para obtener todas las categorías
 */
app.get('/api/categorias', (req, res) => {
    const sql = 'SELECT id_categoria, nombre FROM categorias ORDER BY nombre ASC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error al obtener categorías:', err);
            return res.status(500).json({ error: 'Error al obtener categorías.' });
        }
        res.json(results);
    });
});

/**
 * Endpoint para obtener productos con filtros (categoría, precio, ordenamiento)
 */
app.get('/api/productos/filtrar', (req, res) => {
    const { categoria, precio_min, precio_max, orden } = req.query;

    let sql = `
        SELECT p.*, c.nombre AS nombre_categoria
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        WHERE 1=1 
    `;
    let params = [];

    // 1. Filtro por Categoría
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

    // Ejecutar la consulta
    db.execute(sql, params, (err, results) => {
        if (err) {
            console.error('Error al filtrar productos:', err);
            return res.status(500).json({ error: 'Error interno del servidor al obtener productos.' });
        }
        res.json(results);
    });
});

/**
 * Endpoint para obtener un producto individual (incluye su categoría)
 */
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

/**
 * Función auxiliar para obtener o crear el ID del carrito
 */
const getOrCreateCarritoId = (userId, callback) => {
    // 1. Buscar carrito existente
    let sql = 'SELECT id_carrito FROM carrito WHERE id_usuario = ?';
    db.execute(sql, [userId], (err, results) => {
        if (err) return callback(err);

        if (results.length > 0) {
            // Carrito encontrado
            return callback(null, results[0].id_carrito);
        } else {
            // 2. Crear un nuevo carrito si no existe
            sql = 'INSERT INTO carrito (id_usuario) VALUES (?)';
            db.execute(sql, [userId], (err, result) => {
                if (err) return callback(err);
                // Retorna el ID del carrito recién creado
                callback(null, result.insertId);
            });
        }
    });
};


/**
 * Endpoint para AGREGAR o ACTUALIZAR un producto al carrito
 * Requiere iniciar sesión (checkAuth)
 */
app.post('/api/carrito/agregar', checkAuth, (req, res) => {
    const userId = req.session.userId;
    const { id_producto, cantidad } = req.body;
    
    if (!id_producto || !cantidad || cantidad <= 0) {
        return res.status(400).json({ error: 'Datos de producto inválidos.' });
    }

    getOrCreateCarritoId(userId, (err, id_carrito) => {
        if (err) {
            console.error('Error al obtener/crear carrito:', err);
            return res.status(500).json({ error: 'Error de servidor.' });
        }

        // 1. Verificar si el producto ya está en detalles_carrito
        let sql = 'SELECT cantidad FROM detalles_carrito WHERE id_carrito = ? AND id_producto = ?';
        db.execute(sql, [id_carrito, id_producto], (err, results) => {
            if (err) return res.status(500).json({ error: 'Error de servidor.' });

            if (results.length > 0) {
                // Producto existe: Actualizar la cantidad
                const nuevaCantidad = results[0].cantidad + cantidad;
                sql = 'UPDATE detalles_carrito SET cantidad = ? WHERE id_carrito = ? AND id_producto = ?';
                db.execute(sql, [nuevaCantidad, id_carrito, id_producto], (updateErr) => {
                    if (updateErr) return res.status(500).json({ error: 'Error al actualizar el carrito.' });
                    res.json({ message: 'Cantidad de producto actualizada en el carrito.' });
                });
            } else {
                // Producto NO existe: Insertar nuevo detalle
                sql = 'INSERT INTO detalles_carrito (id_carrito, id_producto, cantidad) VALUES (?, ?, ?)';
                db.execute(sql, [id_carrito, id_producto, cantidad], (insertErr) => {
                    if (insertErr) return res.status(500).json({ error: 'Error al agregar producto al carrito.' });
                    res.json({ message: 'Producto agregado al carrito.' });
                });
            }
        });
    });
});

/**
 * Endpoint para ELIMINAR un producto del carrito
 * Requiere iniciar sesión (checkAuth)
 */
app.post('/api/carrito/eliminar', checkAuth, (req, res) => {
    const userId = req.session.userId;
    const { id_producto } = req.body;

    getOrCreateCarritoId(userId, (err, id_carrito) => {
        if (err) return res.status(500).json({ error: 'Error de servidor.' });

        const sql = 'DELETE FROM detalles_carrito WHERE id_carrito = ? AND id_producto = ?';
        db.execute(sql, [id_carrito, id_producto], (deleteErr, result) => {
            if (deleteErr) {
                console.error('Error al eliminar producto:', deleteErr);
                return res.status(500).json({ error: 'Error al eliminar producto del carrito.' });
            }
            if (result.affectedRows === 0) {
                 return res.status(404).json({ error: 'Producto no encontrado en el carrito.' });
            }
            res.json({ message: 'Producto eliminado del carrito.' });
        });
    });
});

/**
 * Endpoint para MOSTRAR todos los artículos en el carrito
 * Requiere iniciar sesión (checkAuth)
 */
app.get('/api/carrito', checkAuth, (req, res) => {
    const userId = req.session.userId;

    // Consulta para obtener el carrito y sus detalles (productos)
    const sql = `
        SELECT 
            dc.id_detalle_carrito, dc.cantidad, p.id_producto, p.nombre, p.precio, (p.precio * dc.cantidad) AS subtotal
        FROM carrito c
        JOIN detalles_carrito dc ON c.id_carrito = dc.id_carrito
        JOIN productos p ON dc.id_producto = p.id_producto
        WHERE c.id_usuario = ?
    `;

    db.execute(sql, [userId], (err, results) => {
        if (err) {
            console.error('Error al obtener carrito:', err);
            return res.status(500).json({ error: 'Error interno del servidor.' });
        }

        // Calcula el total
        const total = results.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2);

        res.json({ 
            items: results,
            total: total
        });
    });
});


/**
 * Endpoint para REALIZAR EL PEDIDO (CHECKOUT)
 * Requiere iniciar sesión (checkAuth)
 * Esta es la parte más compleja, usa una Transacción SQL para asegurar atomicidad.
 */
app.post('/api/pedidos/checkout', checkAuth, async (req, res) => {
    const userId = req.session.userId;
    const { calle, ciudad, estado, codigo_postal, metodo_pago } = req.body;

    // Validación de campos de dirección
    if (!calle || !ciudad || !codigo_postal || !metodo_pago) {
        return res.status(400).json({ error: 'Faltan datos de envío o método de pago.' });
    }

    let connection; // Usaremos una conexión transaccional

    try {
        // 1. Obtener la conexión y empezar la transacción
        connection = await mysql.createConnection(dbConfig).promise();
        await connection.beginTransaction();

        // 2. Obtener el carrito y sus detalles
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

        // 3. Verificar stock y calcular total
        for (const item of detalles) {
            if (item.cantidad > item.stock) {
                await connection.rollback();
                return res.status(400).json({ error: `Stock insuficiente para producto ID ${item.id_producto}. Solo hay ${item.stock} disponibles.` });
            }
            totalPedido += item.precio * item.cantidad;
        }

        // 4. Guardar/Actualizar la Dirección del Usuario
        const [direccionCheck] = await connection.execute('SELECT id_direccion FROM direcciones WHERE id_usuario = ?', [userId]);
        let id_direccion_envio;

        if (direccionCheck.length > 0) {
            // Actualizar dirección existente
            id_direccion_envio = direccionCheck[0].id_direccion;
            await connection.execute(
                'UPDATE direcciones SET calle = ?, ciudad = ?, estado = ?, codigo_postal = ? WHERE id_usuario = ?',
                [calle, ciudad, estado, codigo_postal, userId]
            );
        } else {
            // Insertar nueva dirección
            const [direccionInsert] = await connection.execute(
                'INSERT INTO direcciones (id_usuario, calle, ciudad, estado, codigo_postal) VALUES (?, ?, ?, ?, ?)',
                [userId, calle, ciudad, estado, codigo_postal]
            );
            id_direccion_envio = direccionInsert.insertId;
        }

        // 5. Crear el PEDIDO
        const [pedidoInsert] = await connection.execute(
            'INSERT INTO pedidos (id_usuario, total, estado, id_direccion_envio, metodo_pago) VALUES (?, ?, ?, ?, ?)',
            [userId, totalPedido.toFixed(2), 'PAGADO', id_direccion_envio, metodo_pago]
        );
        const id_pedido = pedidoInsert.insertId; // ¡Este es el número de pedido!

        // 6. Mover detalles del carrito a detalles_pedido y actualizar stock
        for (const item of detalles) {
            // Insertar detalle del pedido
            await connection.execute(
                'INSERT INTO detalles_pedido (id_pedido, id_producto, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
                [id_pedido, item.id_producto, item.cantidad, item.precio]
            );

            // Actualizar stock del producto (decremento)
            await connection.execute(
                'UPDATE productos SET stock = stock - ? WHERE id_producto = ?',
                [item.cantidad, item.id_producto]
            );
        }

        // 7. Vaciar el carrito
        await connection.execute('DELETE FROM detalles_carrito WHERE id_carrito IN (SELECT id_carrito FROM carrito WHERE id_usuario = ?)', [userId]);
        
        // 8. Confirmar la transacción
        await connection.commit();
        
        // 9. Respuesta de éxito
        res.json({ 
            message: 'Pedido realizado con éxito.', 
            id_pedido: id_pedido,
            total: totalPedido.toFixed(2)
        });

    } catch (error) {
        // Si algo falla, deshacer todos los cambios
        if (connection) {
            await connection.rollback();
        }
        console.error('Error durante el checkout/transacción:', error);
        res.status(500).json({ error: 'Error al procesar el pedido. La transacción fue revertida.' });
    } finally {
        if (connection) {
            await connection.end(); // Cerrar la conexión transaccional
        }
    }
});


// ==========================================================
// INICIAR EL SERVIDOR
// ==========================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js corriendo en http://localhost:${PORT}`);
});