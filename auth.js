require("dotenv").config();

const jwt = require("jsonwebtoken");

function login(login,password){

    if(
        login!==process.env.ADMIN_LOGIN ||
        password!==process.env.ADMIN_PASSWORD
    ){
        return null;
    }

    return jwt.sign(
        {
            admin:true
        },
        process.env.JWT_SECRET,
        {
            expiresIn:"7d"
        }
    );

}

function verify(req,res,next){

    const header=req.headers.authorization;

    if(!header){

        return res.sendStatus(401);

    }

    const token=header.replace("Bearer ","");

    try{

        jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        next();

    }catch{

        return res.sendStatus(401);

    }

}

module.exports={login,verify};