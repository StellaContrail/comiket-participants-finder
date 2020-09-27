// Load packages
var crypto = require("crypto");
const { query } = require("express");
var fetch = require("node-fetch");
const { encode } = require("punycode");
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

exports.TwitterAPI.prototype._sendRequest = async function (method, baseURL, extraParams, oauthToken, oauthTokenSecret) {
    /*
        let header = this.createHeader(method, baseURL, extraParams, oauthToken, oauthTokenSecret);
        let signature = this.createSignature();
        let url = this.createURL(baseURL, extraParams);
    */

    // Collecting parameters
    let params = this._createParameters(oauthToken);
    params.oauth_signature = this._createSignature(method, baseURL, params, extraParams, this._consumer_secret, oauthTokenSecret);
    let headers = this._createHeader(params);
    // HTTP Options
    let options = {
        method: method,
        headers: headers
    };
    let url = this._createURL(baseURL, extraParams);
    options["url"] = url;

    const res = await fetch(url, options);
    const data = await res.text();
    console.log("[DEBUG] SendRequest()");
    console.log(url);
    console.log(options);
    console.log(res.ok);
    console.log(data);
    console.log("---------------------");
    return { status: res.ok, data: data };
}

this.TwitterAPI.prototype._createURL = function (baseURL, extraParams) {
    let str = querystring.stringify(extraParams);
    if (str) {
        return (baseURL + '?' + str);
    } else {
        return baseURL;
    }
}

exports.TwitterAPI.prototype._createParameters = function(oauthToken) {
    let params = {
        oauth_consumer_key: this._consumer_key,
        oauth_nonce: this._getOAuthNonce(),
        //oauth_signature: SIGNATURE,
        //oauth_token: TOKEN,
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: this._getTimestamp(),
        oauth_version: "1.0"
    };
    if (oauthToken) {
        params.oauth_token = oauthToken;
    }
    return params;
}

function escape(str) {
    return encodeURIComponent(str).replace(/[!*()']/g, (c) => { return '%' + c.charCodeAt(0).toString(16); });
}

function concat(array1, array2) {
    let array = Object.assign({}, array1);
    array = Object.assign(array, array2);
    return array;
}

exports.TwitterAPI.prototype._createHeader = function(params) {
    let DST = 'OAuth ';
    for (const [key, value] of Object.entries(params)) {
        DST += escape(key) + '="' + escape(value) + '", ';
    }
    DST = DST.slice(0, -2);
    return { "Authorization": DST };
}


exports.TwitterAPI.prototype._createSignature = function (method, url, params, extraParams, consumerSecret, oauthTokenSecret) {
    let parameter = concat(params, extraParams);
    parameter = this._encodeURIParameters(parameter);
    parameter = this._sortParameters(parameter);
    let paramStr = "";
    for (const [key, value] of Object.entries(parameter)) {
        paramStr += key + "=" + value + "&";
    }
    paramStr = paramStr.slice(0, -1);
    let baseStr = method.toUpperCase() + "&" + escape(url) + "&" + escape(paramStr);
    let signingKey = escape(consumerSecret) + "&" + escape(oauthTokenSecret);
    return this._hash_hmac(baseStr, signingKey);
}

exports.TwitterAPI.prototype._getTimestamp = function() {
    return Math.floor(new Date().getTime() / 1000);
}

exports.TwitterAPI.prototype._encodeURIParameters = function(parameters) {
    let encoded_items = {};
    for (const [key, value] of Object.entries(parameters)) {
        encoded_items[escape(key)] = escape(value);
    }
    return encoded_items;
}

exports.TwitterAPI.prototype._sortParameters = function (parameters) {
    let keys = Object.keys(parameters);
    keys.sort();
    let sorted_parameters = {};
    for (let i = 0; i < keys.length; i++) {
        sorted_parameters[keys[i]] = parameters[keys[i]];
    }
    return sorted_parameters;
}

exports.TwitterAPI.prototype._hash_hmac = function(base_string, signing_key) {
    let hmac = crypto.createHmac("sha1", signing_key);
    hmac.update(base_string);
    return hmac.digest("base64");
}

exports.TwitterAPI.prototype._getOAuthNonce = function () {
    const series = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for(let i = 0; i < 32; i++){
        result += series[Math.floor(Math.random()*series.length)];
    }
    return result;
}

/* 
    This method differs from GET oauth / authorize in that if the user has already granted the application permission, 
    the redirect will occur without the user having to re-approve the application. 
    To realize this behavior, you must enable the Use Sign in with Twitter setting on your application record.
*/
exports.TwitterAPI.prototype.getOAuthURL = function (request_token) {
    return "https://twitter.com/oauth/authenticate?oauth_token=" + request_token;
}

exports.TwitterAPI.prototype.getOAuthURLNew = function (request_token) {
    return "https://twitter.com/oauth/authorize?oauth_token=" + request_token;
}

// Get Request Token
exports.TwitterAPI.prototype.getRequestToken = async function() {
    const method = "POST";
    const command = "request_token";
    const target = OAuthBaseURL + command;
    const extra_params = { oauth_callback: this._callbackURL };

    const res = await this._sendRequest(method, target, extra_params, "", "");
    let result = querystring.parse(res.data);
    let oauthToken = result["oauth_token"];
    return { oauthToken: oauthToken };
}

// Get Access Token
exports.TwitterAPI.prototype.getAccessToken = async function (oauthToken, oauthVerifier) {
    const method = "POST";
    const command = "access_token";
    const target = OAuthBaseURL + command;
    let extraParams = { oauth_verifier: oauthVerifier, oauth_token: oauthToken };

    const res = await this._sendRequest(method, target, extraParams, oauthToken, "");
    let result = querystring.parse(res.data);
    let token = result["oauth_token"];
    let tokenSecret = result["oauth_token_secret"];
    let userId = result["user_id"];
    let screenName = result["screen_name"];
    return { oauthToken: token, oauthTokenSecret: tokenSecret, userId: userId, screenName: screenName };
}

// Get Friends (following) list
exports.TwitterAPI.prototype.getFriendsList = async function (params, session) {
    const method = "GET";
    const command = "friends/list.json";
    let target = APIBaseURL + command;
    params["oauth_token"] = session.oauthToken;

    const res = await this._sendRequest(method, target, params, session.oauthToken, session.oauthTokenSecret);
    let result = JSON.parse(res.data);
    return { users: result.users, next_cursor_str: result.next_cursor_str };
}

// Get Timeline
exports.TwitterAPI.prototype.getTimeline = async function (params, session) {
    const method = "GET";
    const command = "statuses/home_timeline.json";
    let target = APIBaseURL + command;
    params["oauth_token"] = session.oauthToken;
    
    const res = await this._sendRequest(method, target, params, session.oauthToken, session.oauthTokenSecret);
    let result = JSON.parse(res.data);
    return { result: result };
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

