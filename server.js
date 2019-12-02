var express = require("express");
var morgan = require("morgan");
var cookieParser = require("cookie-parser");
var cookieEncrypter = require("cookie-encrypter");
var bodyParser = require('body-parser');
var querystring = require("querystring");
require('dotenv').config();
var crypto = require("crypto");
var config = require("./config");
var twitterAPI = require("./twitter-api");
var fs = require("fs");
var app = express();
const consumer_key = process.env.TWITTER_TOKEN;
const consumer_secret = process.env.TWITTER_TOKEN_SECRET;
const callbackURL = process.env.CALLBACK_URL_LOCAL;
const twitter = new twitterAPI.TwitterAPI(consumer_key, consumer_secret, "http://localhost:3000/success");

app.set("view engine", "ejs");
app.use(morgan("combined"));
app.use(bodyParser.urlencoded({extended: true}));
app.use(cookieParser(crypto.randomBytes(256).toString('base64')));
app.use(cookieEncrypter(crypto.randomBytes(256).toString('base64').slice(0, 32)));

app.route(/^\/(index)?$/)
    .get((req, res) => {
        console.log("ConsumerKey : " + consumer_key);
        res.render("index");
    })
    .post((req, res) => {
        twitter.getRequestToken((err, token) => {
            if (res.resolve_error(err)) { return; }
            if (req.body["sign_in"] == "new_old") {
                if (req.signedCookies["LOGIN_INFO"]) {
                    return res.redirect("/success");
                } else {
                    return res.redirect(twitter.getOAuthURL(token));
                }
            } else {
                return res.redirect(twitter.getOAuthURLNew(token));
            }
        });
    });
app.get("/img/bigsight.jpg", (req, res, next) => {
    res.writeHead(200, {"Content-Type":"image/jpeg"});
    fs.readFile("./views/img/bigsight.jpg", (err, data) => {
        if (res.resolve_error(err)) {
            return;
        } else {
            return res.end(data);
        }
    });
});

app.get("/success", (req, res, next) => {
    
    // For those from /success.ejs
    let cookie = req.signedCookies["LOGIN_INFO"];

    // Check if session is alive
    if (cookie) {
        let parsed_cookie = querystring.parse(cookie);
        let user_id = parsed_cookie["user_id"];
        let oauth_token = parsed_cookie["oauth_token"];
        let oauth_token_secret = parsed_cookie["oauth_token_secret"];

        if (oauth_token && oauth_token_secret && user_id) {
        } else {
            return res.render("error", { err: "認証情報が取得できませんでした。トップページから再び認証して下さい。"});
        }

        let usernames = {};
        let next_cursor_str = "-1";
        let parameters = { user_id: user_id, count: 200, skip_status: true, include_user_entities: false };
        getFriends(next_cursor_str, usernames);

        function getFriends(next_cursor_str, usernames) {
            parameters["next_cursor_str"] = next_cursor_str;
            twitter.getFriendsList(parameters, oauth_token, oauth_token_secret, (_err, _users, _next_cursor_str) => {
                if (res.resolve_error(_err)) {
                    return;
                } else if (_users == null && res.resolve_error("Invalid Response from API")) {
                    return;
                }
                for (var key in _users) {
                    var user = _users[key];
                    if (isParticipating(user.name)) {
                        usernames[user.screen_name] = user.name;
                    }
                }
                next_cursor_str = _next_cursor_str;
                if (Number(next_cursor_str) == 0) {
                    let user_data = fetchLocation(usernames);
                    res.render("success", { user_data: user_data, err: null });
                } else {
                    // if there is more followings to be read, call getFriends recursively.
                    getFriends(next_cursor_str, usernames);
                }
            });
        }
    } else {
        let oauth_verifier = req.query.oauth_verifier;
        let oauth_token = req.query.oauth_token;
        if (oauth_token && oauth_verifier) {
            twitter.getAccessToken(oauth_token, oauth_verifier, (_err, _oauth_token, _oauth_token_secret, _user_id, _screen_name) => {
                if (res.resolve_error(_err)) { return; }

                console.log("----------------------------------------------------------------------");
                console.log("Twitter User \"" + _screen_name + "@" + _user_id + "\" has authorized");
                console.log("TOKEN  : " + _oauth_token);
                console.log("SECRET : " + _oauth_token_secret);
                console.log("----------------------------------------------------------------------");
    
                res.cookie("LOGIN_INFO", "user_id=" + _user_id + "&oauth_token=" + _oauth_token + "&oauth_token_secret=" + _oauth_token_secret, { signed: true, sameSite: 'lax' });
                return res.redirect("/success");
            });
        } else {
            return res.render("error", { err: "認証情報が取得できませんでした。トップページから再び認証して下さい。" });
        }
    }
});

function fetchLocation(usernames) {
    let users_data = [];
    for (let key in usernames) {
        let formattedUsername = usernames[key]
            .toLowerCase()
            .replace(/\s+/g, "")
            .replace(/[()（）【】「」『』]/g, "")
            .replace("曜日", "")
            .replace("曜", "")
            .kanji2num();
        formattedUsername = formattedUsername
            .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) { return String.fromCharCode(s.charCodeAt(0) - 65248); });
        formattedUsername = formattedUsername
            .replace(comiket_name, "");
        let user_data = formattedUsername.match(/([1-4])?(?:日|日目)?([月火水木金土日]?)([西南])(\d?)([あ-んア-ンa-z])-?(\d{2})(a|b|ab)?/);

        users_data.push({
            id: key,
            name: usernames[key],
            day: user_data[1] ? user_data[1] : "-",
            day_str: user_data[2] ? user_data[2] : "-",
            loc_hall: (user_data[3] ? user_data[3] : ""),
            loc_hall_num: (user_data[4] ? user_data[4] : ""),
            loc_block: user_data[5] ? user_data[5] : "-",
            loc_desk: (user_data[6] ? user_data[6] : "") + (user_data[7] ? user_data[7] : "")
        });
    }
    // Sort users_data by day, day_str, loc_hall, loc_hall_num in this order
    users_data.sort((a, b) => {
        let loc_hall_num_a = a.loc_hall_num == '' ? 5 : a.loc_hall_num;
        let loc_hall_num_b = b.loc_hall_num == '' ? 5 : b.loc_hall_num;
        if (loc_hall_num_a < loc_hall_num_b) {
            return -1;
        } else {
            return 1;
        }
    });
    const hall_name = ["西", "南", ""];
    users_data.sort((a, b) => {
        let index_a = hall_name.indexOf(a.loc_hall);
        let index_b = hall_name.indexOf(b.loc_hall);
        if (index_a < index_b) {
            return -1;
        } else {
            return 1;
        }
    });
    const day_of_week = ["月", "火", "水", "木", "金", "土", "日", "-"];
    users_data.sort((a, b) => {
        let index_a = day_of_week.indexOf(a.day_str);
        let index_b = day_of_week.indexOf(b.day_str);
        if (index_a < index_b) {
            return -1;
        } else {
            return 1;
        }
    });
    users_data.sort((a, b) => {
        let day_a = a.day == '-' ? 5 : a.day;
        let day_b = b.day == '-' ? 5 : b.day;
        if (day_a < day_b) {
            return -1;
        } else {
            return 1;
        }
    });

    return users_data;
}

const regex_comiket = /[西南]\d?[あ-んア-ンa-z]-?\d{2}(a|b|ab)?/;
const comiket_name = "c97";
function isParticipating(username) {
        var formattedUsername = username
            .toLowerCase()
            .replace(/\s+/g, "")
            .replace(/[()（）【】「」『』]/g, "")
            .kanji2num();
        formattedUsername = formattedUsername
            .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (s) { return String.fromCharCode(s.charCodeAt(0) - 65248); });
        formattedUsername = formattedUsername
        .replace(comiket_name, "");
    return regex_comiket.test(formattedUsername);
}

const kanji_series = "一二三四";
String.prototype.kanji2num = function () {
    let str = this;
    for (let i = 0; i < str.length; i++) {
        let pos = kanji_series.indexOf(str[i]);
        if (pos > -1) {
            str = str.replace(str[i], pos+1)
        }
    }
    return str;
}

// ERROR MESSAGE HANDLER
express.response.resolve_error = function (err) {
    if (err) {
        res.render("error", { err: err });
        return true;
    }
    return false;
}

app.get("*", (req, res) => {
    res.status(404);

    if (req.accepts("html")) {
        res.render("error", { err: "404 Not Found (Requested URL : " + req.url + ")" });
        return;
    }

    res.type("text").send("404 Not Found (Requested URL : " + req.url + ")");
});

// Start listening
app.listen(config.port, config.hostname, function () {
    console.log("Start Listening to " + config.hostname + ":" + config.port + "\n");
});