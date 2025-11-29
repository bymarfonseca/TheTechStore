// authMiddleware.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

const authMiddleware = (req, res, next) => {

    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ msg: 'Acceso denegado. No se proporcionó token.' });
    }

    try {
       
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
     
        req.user = decoded; 
        
        next(); 
    } catch (e) {
        res.status(401).json({ msg: 'Token no válido.' });
    }
};

module.exports = authMiddleware;