// Load packages
var crypto = require("crypto");
var fetch = require("node-fetch");
var request = require("request");
var querystring = require("querystring");

const OAuthBaseURL = "https://api.twitter.com/oauth/";
const APIBaseURL = "https://api.twitter.com/1.1/";

// Constructor
exports.TwitterAPI = function(consumer_key, consumer_secret, callbackURL) {
    this._consumer_key = consumer_key;
    this._consumer_secret = consumer_secret;
    this._callbackURL = callbackURL;
    return this;
}

exports.TwitterAPI.prototype._sendRequest = function (method, url, extra_params, oauth_token_secret, callback) {
    // Collecting parameters
    let parameters = this._createParameters(extra_params);
    let encoded_parameters = this._encodeURIParameters(parameters);
    let sorted_parameters = this._sortParameters(encoded_parameters);
    // Create the signature base string
    let base_string = this._createBaseString(sorted_parameters, method, url);
    // Get a signing key
    let signing_key = "";
    if (oauth_token_secret) {
        signing_key = this._createSigningKey(oauth_token_secret);
    } else {
        signing_key = this._createSigningKey("");
    }
    // Calc the signature
    let signature = this._hash_hmac(base_string, signing_key);
    // Build the header string
    let headers = {
        "Authorization": this._createAuthHeaders(parameters, signature)
    };
    // HTTP Options
    let options = {
        method: method,
        headers: headers
    };
    var queries_str = querystring.stringify(extra_params);
    if (queries_str) {
        options["url"] = url + '?' + queries_str;
    } else {
        options["url"] = url;
    }

    let err;
    fetch(url, options)
        .then(function (res) {
            err = res.ok ? null : res.statusText;
            return res;
        })
        .then(res => res.text())
        .then(text => callback(err, text));
}

// Create HTTP Parameters from scratches
exports.TwitterAPI.prototype._createParameters = function(extra_params) {
    let parameters = {
        oauth_consumer_key: this._consumer_key,
        oauth_nonce: this._getOAuthNonce(),
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: this._getTimestamp(),
        oauth_version: "1.0A"
    };
    return Object.assign(parameters, extra_params);
}

// Get UTC Timestamp in seconds
exports.TwitterAPI.prototype._getTimestamp = function() {
    return Math.floor(new Date().getTime() / 1000);
}

// encodeURIComponent key and value of each associative array element
exports.TwitterAPI.prototype._encodeURIParameters = function(parameters) {
    let encoded_items = {};
    for (const [key, value] of Object.entries(parameters)) {
        encoded_items[encodeURIComponent(key)] = encodeURIComponent(value);
    }
    return encoded_items;
}

// Sort HTTP Parameters
exports.TwitterAPI.prototype._sortParameters = function (parameters) {
    let keys = Object.keys(parameters);
    keys.sort();
    let sorted_parameters = {};
    for (let i = 0; i < keys.length; i++) {
        sorted_parameters[keys[i]] = parameters[keys[i]];
    }
    return sorted_parameters;
}

// Create base string
exports.TwitterAPI.prototype._createBaseString = function (parameters, method, target) {
    let param_str = "";
    for (const [key, value] of Object.entries(parameters)) {
        param_str += key + "=" + value + "&";
    }
    param_str = param_str.slice(0, -1);
    let base_string = method + "&" + encodeURIComponent(target) + "&" + encodeURIComponent(param_str);
    return base_string;
}

// Create signing key
exports.TwitterAPI.prototype._createSigningKey = function (token_secret) {
    return encodeURIComponent(this._consumer_secret) + "&" + encodeURIComponent(token_secret);
}

// Encrypt signing key with HMAC-SHA1
exports.TwitterAPI.prototype._hash_hmac = function(base_string, signing_key) {
    let hmac = crypto.createHmac("sha1", signing_key);
    hmac.update(base_string);
    return hmac.digest("base64");
}

// Create Authorization header
exports.TwitterAPI.prototype._createAuthHeaders = function(parameters, signature) {
    parameters["oauth_signature"] = signature;
    let auth_header_str = "OAuth ";

    // Order of the array doesn't matter
    for (const [key, value] of Object.entries(parameters)) {
        auth_header_str += encodeURIComponent(key) + "=" + "\"" + encodeURIComponent(value) + "\", ";
    }
    auth_header_str = auth_header_str.slice(0, -2);
    return auth_header_str;
}

// Get OAuth Nonce
exports.TwitterAPI.prototype._getOAuthNonce = function () {
    const series = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for(let i = 0; i < 32; i++){
        result += series[Math.floor(Math.random()*series.length)];
    }
    return result;
}

// Get OAuth Authorization Page URL
exports.TwitterAPI.prototype.getOAuthURL = function (request_token) {
    return "https://twitter.com/oauth/authenticate?oauth_token=" + request_token;
}

exports.TwitterAPI.prototype.getOAuthURLNew = function (request_token) {
    return "https://twitter.com/oauth/authorize?oauth_token=" + request_token;
}

// Get Request Token
exports.TwitterAPI.prototype.getRequestToken = function(callback) {
    const command = "request_token";
    const method = "POST";
    const target = OAuthBaseURL + command;
    const extra_params = { oauth_callback: this._callbackURL };

    this._sendRequest(method, target, extra_params, null, (err, body) => {
        let feedback = this._hasError(err, body);
        if (feedback.hasError) {
            callback(feedback.result);
            return;
        } else {
            let result = querystring.parse(body);
            let oauth_token = result["oauth_token"];
            callback(null, oauth_token);
            return;
        }
    });
}

// Get Access Token
exports.TwitterAPI.prototype.getAccessToken = function (oauth_token, oauth_verifier, callback) {
    const method = "POST";
    const command = "access_token";
    const target = OAuthBaseURL + command;
    let extra_params = { oauth_verifier: oauth_verifier, oauth_token: oauth_token };

    this._sendRequest(method, target, extra_params, null, (err, body) => {
        let feedback = this._hasError(err, body);
        if (feedback.hasError) {
            callback(feedback.result);
            return;
        } else {
            let result = querystring.parse(body);
            let oauth_token = result["oauth_token"];
            let oauth_token_secret = result["oauth_token_secret"];
            let user_id = result["user_id"];
            let screen_name = result["screen_name"];
            callback(null, oauth_token, oauth_token_secret, user_id, screen_name);
            return;
        }
    });
}

// Get Friends (following) list
exports.TwitterAPI.prototype.getFriendsList = function (params, oauth_token, oauth_token_secret, callback) {
    const command = "friends/list.json";
    const method = "GET";
    let target = APIBaseURL + command;
    params["oauth_token"] = oauth_token;
    
    this._sendRequest(method, target, params, oauth_token_secret, (err, body) => {
        let feedback = this._hasError(err, body);
        if (feedback.hasError) {
            callback(feedback.result);
            return;
        } else {
            let result = JSON.parse(body);
            let users = result.users;
            let next_cursor_str = result.next_cursor_str;
            callback(null, users, next_cursor_str);
            return;
        }
    });
}

exports.TwitterAPI.prototype._hasError = function(err, body) {
    if (err) {
        return { hasError: true, result: err };
    } else {
        if (body == "現在この機能は一時的にご利用いただけません") {
            return { hasError: true, result: "APIのアクセス上限に達しました。15分間待って再びアクセスしてください" };
        }
        if (body == null) {
            return { hasError: true, result: err };
        }
        try {
            let parsed_body = JSON.parse(body);
            if (Number(parsed_body.errors[0].code) == 32) {
                return { hasError: true, result: parsed_body.errors[0].body }
            }
        } catch (e) { }
        
        return { hasError: false, result: body };
    }
}

