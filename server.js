const express = require("express");
const morgan = require("morgan");
const bodyParser = require('body-parser');
require('dotenv').config();
const config = require("./config");
const twitterAPI = require("./twitter-api");
const app = express();
const helmet = require("helmet");
const consumer_key = process.env.TWITTER_TOKEN;
const consumer_secret = process.env.TWITTER_TOKEN_SECRET;
const callbackURL = process.env.CALLBACK_URL;
const twitter = new twitterAPI.TwitterAPI(consumer_key, consumer_secret, callbackURL);

app.set("view engine", "ejs");
app.use(helmet());

app.use(helmet.contentSecurityPolicy({
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://code.jquery.com/jquery-3.4.1.slim.min.js", "https://cdn.jsdelivr.net/npm/popper.js@1.16.0/dist/umd/popper.min.js", "https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/js/bootstrap.min.js"],
        styleSrc: ["'self'", "https://stackpath.bootstrapcdn.com/bootstrap/4.4.1/css/bootstrap.min.css"]
    }
}));

app.use(morgan("tiny"));
app.use(express.static(__dirname + "/views/static"));
app.use(bodyParser.urlencoded({extended: true}));

app.route(/^\/(index)?$/)
    .get((req, res) => {
        res.render("index");
    })
    .post((req, res, next) => {
        (async () => {
            const oauthRequestToken = await twitter.getRequestToken();

            switch (req.body["sign_in"]) {
                case "old":
                    return res.redirect(twitter.getOAuthURL(oauthRequestToken.oauthToken));
                case "new":
                    return res.redirect(twitter.getOAuthURLNew(oauthRequestToken.oauthToken));
            }
        })().catch(next);
    });

app.post("/error", (req, res) => {
    if (req.body["go_back"] == "true") {
        return res.redirect("index");
    }
    return;
});

app.get("/login_success", (req, res, next) => {
    (async () => {
        let oauth_verifier = req.query.oauth_verifier;
        let oauth_token = req.query.oauth_token;
        let session = {
            oauthToken: "",
            oauthTokenSecret: "",
            userId: "",
            screenName: ""
        }
        
        const isParametersValid = (oauth_verifier && oauth_token);
        if (isParametersValid) {
            session = await twitter.getAccessToken(oauth_token, oauth_verifier);

            //  For debug only
            /*
            console.log("[DEBUG] Login_Success");
            console.log("User        : " + session.screenName + "@" + session.userId);
            console.log("Token       : " + session.oauthToken);
            console.log("SecretToken : " + session.oauthTokenSecret);
            console.log("---------------------");
            */
            //
        
        } else {
            if (res.resolve_error("認証情報が取得できませんでした。トップページから再び認証して下さい。")) { return; }
        }
        
        let users = await getFollowings(session);
        users = filterEntries(users);
        let userData = getDesks(users);
        res.render("result", { user_data: userData, comiket: { name: config.comiket_name } });

    })().catch(next);
});

// Fetch all followings' usernames
async function getFollowings(session) {
    let params = { user_id: session.userId, count: 200, skip_status: true, include_user_entities: false, cursor: -1 };
    let users = new Map();

    while (params.cursor != 0) {
        const result = await twitter.getFriendsList(params, session);
        if (result.users == null) {
            throw new Error("Invalid Response from API " + result.err);
        }
        for (const user of result.users) {
            users[user.screen_name] = user.name;
        }
        params.cursor = result.next_cursor_str;
    }
    return users;
}

// Collect entries
function filterEntries(usernames) {
    let participants_usernames = {};
    for (const [screen_name, name] of Object.entries(usernames)) {
        if (isParticipating(name)) {
            participants_usernames[screen_name] = name;
        }
    }
    return participants_usernames;
}

// Create another array with participants usernames
// The given usernames in the parameters should be only the participants'
function getDesks(usernames) {
    let users_data = [];
    for (const [id, username] of Object.entries(usernames)) {
        let formattedUsername = formatUsernameFrom(username);
        // Need to store this expression in config.js
        let user_data = formattedUsername.match(/([1-4])?(?:日|日目)?([月火水木金土日]?)([西南])(\d?)([あ-んア-ンa-z])-?(\d{2})(a|b|ab)?/) || "";
        users_data.push({
            id: id,
            name: username,
            day: user_data[1] || 100,
            day_str: user_data[2] || "-",
            loc_hall: (user_data[3] || ""),
            loc_hall_num: (user_data[4] || 100),
            loc_block: user_data[5] || "-",
            loc_desk: (user_data[6] || "") + (user_data[7] || "")
        });
    }
    // Sort users_data
    const day_of_week = ["月", "火", "水", "木", "金", "土", "日", "-"];
    users_data.sort((a, b) => {
        if (a.day < b.day) {
            return -1;
        } else if (a.day > b.day) {
            return 1;
        }

        let index_a = day_of_week.indexOf(a.day_str);
        let index_b = day_of_week.indexOf(b.day_str);
        if (index_a < index_b) {
            return -1;
        } else if (index_a > index_b) {
            return 1;
        }

        index_a = config.hall_name.indexOf(a.loc_hall);
        index_b = config.hall_name.indexOf(b.loc_hall);
        if (index_a < index_b) {
            return -1;
        } else if (index_a > index_b) {
            return 1;
        }

        if (a.loc_hall_num < b.loc_hall_num) {
            return -1;
        } else if (a.loc_hall_num > b.loc_hall_num) {
            return 1;
        }
    });
    return users_data.map(user_data => {
        user_data.day = (user_data.day == 100 ? '-' : user_data.day);
        user_data.loc_hall_num = (user_data.loc_hall_num == 100 ? '' : user_data.loc_hall_num);
        return user_data;
    });
}

// Test if a user with the username is participating Comiket
function isParticipating(username) {
    return config.regex_comiket.test(formatUsernameFrom(username)) || (username.indexOf(config.comiket_name) > -1);
}

// Format participants' usernames
function formatUsernameFrom(username) {
    return username
        .toLowerCase()                                  // Change upper case to lower case
        .replace(/\s+/g, "")                            // Remove all spaces
        .replace(/[()（）【】「」『』]/g, "")            // Remove all brackets
        .kanji2num()                                    // Change all kanji numerals to arabic ones
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => { return String.fromCharCode(s.charCodeAt(0) - 65248); }) // Change full width words into half ones
        .replace(config.comiket_name, "");              // Remove Comiket name
}


// Format number from Kanji to Arabic numerals
String.prototype.kanji2num = function () {
    let str = this;
    for (let i = 0; i < str.length; i++) {
        let pos = config.kanji_series.indexOf(str[i]);
        if (pos > -1) {
            str = str.replace(str[i], pos+1)
        }
    }
    return str;
}

// ERROR MESSAGE HANDLER
// If Error Exists             => Return true  & Jump to error page
// IF Error Cannot be resolved => Return false & Jump to error page with only string
// If Error Doesn't Exist      => Return null
express.response.resolve_error = function (err) {
    if (err) {
        this.render("error", { err: err });
        return true;
    } else if (err == null) {
        return null;
    }
    this.send("CRITICAL ERROR OCCURRED ( Or maybe you didn't set error status to null even though the process ended successfully? )");
    return false;
}

app.get("*", (req, res) => {
    res.status(404);
    let err_msg = "404 Not Found (Requested URL : " + req.url + ")";
    if (req.accepts("html")) {
        res.render("error", { err: err_msg });
        return;
    }
    res.type("text").send(err_msg);
});

// Start listening
app.listen(config.port, function () {
    console.log("Start Listening... PORT=" + config.port + "\n");
});