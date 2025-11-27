// authRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();


router.post('/login', async (req, res) => {
    const { correo_usuario, contraseña_usuario } = req.body;
    
    try {
   
        const [rows] = await pool.query(
            'SELECT id_usuario, nombre_usuario, correo_usuario, contraseña_usuario FROM usuario WHERE correo_usuario = ?', 
            [correo_usuario]
        );

        if (rows.length === 0) {
            return res.status(400).json({ msg: 'Credenciales inválidas: Correo no encontrado.' });
        }

        const user = rows[0];

     
        const isMatch = await bcrypt.compare(contraseña_usuario, user.contraseña_usuario);

        if (!isMatch) {
            return res.status(400).json({ msg: 'Credenciales inválidas: Contraseña incorrecta.' });
        }

  
        const payload = {
            id_usuario: user.id_usuario,
            nombre_usuario: user.nombre_usuario
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.json({ token, nombre_usuario: user.nombre_usuario });

    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).send('Error del servidor');
    }
});


router.post('/register', async (req, res) => {
    const { nombre_usuario, correo_usuario, contraseña_usuario, telefono_usuario } = req.body;

    try {
        // 1. Verificar si el usuario ya existe
        const [existingUser] = await pool.query('SELECT id_usuario FROM usuario WHERE correo_usuario = ?', [correo_usuario]);

        if (existingUser.length > 0) {
            return res.status(400).json({ msg: 'El correo electrónico ya está registrado.' });
        }

        // 2. Cifrar la contraseña
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(contraseña_usuario, salt);

        // 3. Guardar el nuevo usuario en la DB
        await pool.query(
            'INSERT INTO usuario (nombre_usuario, correo_usuario, contraseña_usuario, telefono_usuario) VALUES (?, ?, ?, ?)',
            [nombre_usuario, correo_usuario, hashedPassword, telefono_usuario]
        );

        res.status(201).json({ msg: 'Cliente registrado exitosamente.' });

    } catch (err) {
        console.error('Error en registro:', err);
        res.status(500).send('Error del servidor al registrar cliente');
    }
});


router.get('/profile', require('./authMiddleware'), async (req, res) => {
    try {
        
        const userId = req.user.id_usuario;
        

        const [rows] = await pool.query(
            'SELECT nombre_usuario, correo_usuario, "placeholder_url_foto.png" AS foto_perfil FROM usuario WHERE id_usuario = ?', 
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ msg: 'Usuario no encontrado.' });
        }

        
        const [nombre, ...apellidos] = rows[0].nombre_usuario.split(' ');
        
        res.json({
            nombre: nombre,
            apellido: apellidos.join(' ') || '', // Puede que no tenga apellido si solo es un nombre
            foto_perfil: rows[0].foto_perfil // URL de la foto
        });
    } catch (err) {
        console.error('Error al obtener perfil:', err);
        res.status(500).send('Error del servidor');
    }
});

module.exports = router;