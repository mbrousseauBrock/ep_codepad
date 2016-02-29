// hash based authentication for etherpad
// 2014-2016 - István Király - LaKing@D250.hu
// Contributions by Robin Schneider <ypid@riseup.net>

var fs = require('fs');
var settings = require('ep_etherpad-lite/node/utils/Settings');
var authorManager = require('ep_etherpad-lite/node/db/AuthorManager');
var sessionManager = require('ep_etherpad-lite/node/db/SessionManager');
var crypto = require('crypto');

// npm install bcrypt
var bcrypt = require('bcrypt');

// ocrypt-relevant options
var hash_typ = "sha512";
var hash_dig = "hex";

// default dir to search for hash files
var hash_dir = '/var/codepad/users';
// by default the extension is actually a file, so usernames are actually folders
var hash_ext = '/.hash';
// by default peple logged in that authenticated over a hash file, are admins ?
var hash_adm = true;
var allow_namechange = true;

if (settings.ep_hash_auth) {
    if (settings.ep_hash_auth.hash_typ) hash_typ = settings.ep_hash_auth.hash_typ;
    if (settings.ep_hash_auth.hash_dig) hash_dig = settings.ep_hash_auth.hash_dig;
    if (settings.ep_hash_auth.hash_dir) hash_dir = settings.ep_hash_auth.hash_dir;
    if (settings.ep_hash_auth.hash_ext) hash_ext = settings.ep_hash_auth.hash_ext;
    if (settings.ep_hash_auth.hash_adm) hash_adm = settings.ep_hash_auth.hash_adm;

    if (settings.ep_hash_auth.allow_namechange)
        if (settings.ep_hash_auth.allow_namechange === false) allow_namechange = false;
}

exports.authenticate = function(hook_name, context, cb) {
    if (context.req.headers.authorization && context.req.headers.authorization.search('Basic ') === 0) {
        var userpass = new Buffer(context.req.headers.authorization.split(' ')[1], 'base64').toString().split(":");
        var username = userpass.shift();
        var password = userpass.join(':');

        var hash = crypto.createHash(hash_typ).update(password).digest(hash_dig);

        // Authenticate user via settings.json
        if (settings.users[username] !== undefined) {
            // hash defined in "hash" of users
            if (settings.users[username].hash !== undefined) {
                if (settings.users[username].hash == hash) {
                    console.log("Authenticated (crypto) " + username);
                    settings.users[username].username = username;
                    context.req.session.user = settings.users[username];
                    return cb([true]);
                } else {
                    bcrypt.compare(password, settings.users[username].hash, function(err, res) {
                        if (err || !res) return cb([false]);
                        else {
                            console.log("Authenticated (bcrypt) " + username);
                            settings.users[username].username = username;
                            context.req.session.user = settings.users[username];
                            return cb([true]);
                        }
                    });
                }
            } else return cb([false]);

        } else {
            // Authenticate user via hash_dir
            var path = hash_dir + "/" + username + hash_ext;
            fs.readFile(path, 'utf8', function(err, contents) {
                if (err) {
                    // file not found, or inaccessible
                    console.log("AUTH: cannot authenticate " + username);
                    return cb([false]);
                } else {
                    if (contents === hash) {
                        console.log("Authenticated (crypto-file) " + username);
                        settings.users[username] = {};
                        settings.users[username].username = username;
                        settings.users[username].is_admin = hash_adm;
                        context.req.session.user = settings.users[username];
                        return cb([true]);
                    } else {
                        bcrypt.compare(password, contents, function(err, res) {
                            if (err || !res) return cb([false]);
                            else {
                                console.log("Authenticated (bcrypt-file) " + username);
                                settings.users[username] = {};
                                settings.users[username].username = username;
                                settings.users[username].is_admin = hash_adm;
                                context.req.session.user = settings.users[username];
                                return cb([true]);
                            }
                        });
                    }
                }
            });
        }
    } else return cb([false]);

};

// generate the color based on the username, if not defined in settings.json
var stringToColour = function(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    var colour = '#';
    for (var j = 0; j < 3; j++) {
        var value = (hash >> (j * 8)) & 0xFF;
        colour += ('00' + value.toString(16)).substr(-2);
    }
    return colour;
};

exports.handleMessage = function(hook_name, context, cb) {

    if (context.message.type == "CLIENT_READY") {
        if (!context.message.token || !context.client.manager) {
            // CLIENT_READY message has NO! token!
            // or ontext.client.manager is undefined ...
            // TODO review needed. How can this be undefined?
        } else {
            var client_id = context.client.id;
            var session_user = context.client.manager.handshaken[client_id].session.user;
            var token = context.message.token;

            // if require-authentication is enabled
            if (typeof session_user !== 'undefined' && typeof session_user.username !== 'undefined' && session_user.username !== 'username')
                authorManager.getAuthor4Token(token, function(err, author) {
                    if (err) {
                        console.log('Auth-Error, No authorID for token: ' + token);
                    } else {

                        console.log('[AUTH] Pad "' + context.message.padId + '": User: ' + session_user.username);
                        authorManager.setAuthorName(author, session_user.username);
                        if (typeof session_user.color !== 'undefined')
                            authorManager.setAuthorColorId(author, session_user.color);
                        else {
                            authorManager.setAuthorColorId(author, stringToColour(session_user.username));
                        }
                    }
                });

        }
    } else if (context.message.type == "COLLABROOM" && context.message.data.type == "USERINFO_UPDATE") {
        if (allow_namechange) return cb([context.message]);
        else return cb([null]);
    }
    return cb([context.message]);
};