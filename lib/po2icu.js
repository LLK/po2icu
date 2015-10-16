var fs = require('fs');
var gettext = require('node-gettext');
var IntlMessageFormat = require('intl-messageformat');
var plurals = require('node-gettext/lib/plurals');

var gt = new gettext();

module.exports = {
    /**
     * @param  {A po msg string}
     * @return {the po msg string with all arbitrary whitespace turned into one space}
     */
    cleanWhiteSpace: function (msg) {
        msg = msg.replace(/\\n/g, ' ');
        return msg.replace(/\s\s+/g, ' ');
    },

    /*
        Given a po string (msgid or msgstr) that contains python-formatted
        variables, this will convert the string into an ICU-formatted string.
    */
    pythonToICU: function (msg) {
        msg = this.cleanWhiteSpace(msg);
        msg = msg.replace(/%\([a-zA-Z0-9_.|]+\)s/g, function (variable_name) {
            var name = variable_name.substring(2, (variable_name.length - 2));
            return '{' + name + '}';
        });
        msg = msg.replace(/%\([a-zA-Z0-9_.|]+\)d/g, function (variable_name) {
            var name = variable_name.substring(2, (variable_name.length - 2));
            return '{' + name + ', number}';
        });
        msg = msg.replace(/%(d|i)/g, '{digit, number}');
        msg = msg.replace(/%s/g, '{string}');
        return msg;
    },

    /*
        Converts a python po-formatted plural msg into an icu-formatted plural.
        Takes as args:
            msgs: list of strings for each plural form
            pluralForms: list of icu plural forms used by this language
                choices are: ['zero', 'one', 'two', 'few', 'many', 'other']
    */
    pythonPluralToICU: function (msgs, pluralForms) {
        var msgKey = 'digit';
        var hasVariableName = false;
        for (var i=0; i<msgs.length; i++) {
            if (msgs[i].match(/%\([a-zA-Z0-9_.|]+\)d/g) !== null) {
                var match = msgs[i].match(/%\([a-zA-Z0-9_.|]+\)d/g)[0];
                msgKey = match.substring(2, (match.length - 2));
                hasVariableName = true;
                break;
            }
        }

        var icuMsg = '{' + msgKey + ', plural,\n';
        var self = this;
        pluralForms.forEach(function (plural) {
            var msg = msgs[plural.poPlural];
            msg = self.cleanWhiteSpace(msg);
            if (hasVariableName) {
                msg = msg.replace(/%\([a-zA-Z0-9_.|]+\)d/g, '{' + msgKey + '}');
            } else {
                msg = msg.replace(/%(d|i)/g, '{' + msgKey + '}');
            }
            icuMsg = icuMsg + '    ' + plural.icuPlural + ' {' + msg + '}\n';
        });
        icuMsg = icuMsg + '}';
        return icuMsg;
    },

    /*
        Takes as input a msg object, as returned by the gettext-parser module.
        It contains a msgid, msgstr, and comments.

        Input language format is searched for first within the flag comment of the
        msg chunk, then, in the absence of a flag, within any options passed to
        the method.
    */
    msgToICU: function (msg, options) {
        var format = options.poFormat || '';
        if (msg.comments && msg.comments.flag) {
            format = msg.comments.flag;
        }
        var msgid = msg.msgid;
        var msgstr = msg.msgstr[0];

        var icuId = '';
        var icuStr = '';
       
        if (format.match(/python-format/g) !== null) {
            icuId = this.pythonToICU(msgid);
            icuStr = this.pythonToICU(msgstr);
        }
        else if (format.match(/c-format/g) !== null) {
            icuId = this.pythonToICU(msgid);
            icuStr = this.pythonToICU(msgstr);
        } else {
            icuId = msgid;
            icuStr = msgstr;
        }
        
        var icuObject = {'icuId': icuId, 'icuStr': icuStr};
        return icuObject;
    },

    /*
        For the given language, get the plurals used in gettext, then find their
        equivalent label in ICU.
    */
    getPluralsForDomain: function (domain) {
        var pluralForms = [];
        var normalizedDomain = gt._normalizeDomain(domain, true);
        var poPluralsInfo = plurals[normalizedDomain];
        var icuPluralsFunction = IntlMessageFormat.prototype._findPluralRuleFunction(normalizedDomain);

        poPluralsInfo.examples.forEach(function (plural) {
            pluralForms.push({
                icuPlural: icuPluralsFunction(plural.sample),
                poPlural: plural.plural});
        });
        return pluralForms;
    },

    /*
        Handles conversion of plural forms. Only difference between this and
        `pythonToICU` is that this also takes a domain argument, and an optional
        source domain argument (i.e. source language code).
    */
    pluralMsgToICU: function (msg, domain, options) {
        var format = options.poFormat || '';
        var source = options.sourceDomain || 'en';
        if (msg.comments && msg.comments.flag) {
            format = msg.comments.flag;
        }
        var msgids = [msg.msgid, msg.msgid_plural];
        var msgstr = msg.msgstr;

        var icuPluralForms = this.getPluralsForDomain(domain);
        var icuSourcePluralForms = this.getPluralsForDomain(source);
        var icuId = '';
        var icuStr = '';
        
        if (format.match(/python-format/g) !== null) {
            icuId = this.pythonPluralToICU(msgids, icuSourcePluralForms);
            icuStr = this.pythonPluralToICU(msgstr, icuPluralForms);
        }
        else if (format.match(/c-format/g) !== null) {
            icuId = this.pythonPluralToICU(msgids, icuSourcePluralForms);
            icuStr = this.pythonPluralToICU(msgstr, icuPluralForms);
        }

        var icuObject = {'icuId': icuId, 'icuStr': icuStr};
        return icuObject;
    },

    /*
        Parses a string representation of a po file into a JSON object asynchronously.
        The JSON object has the following structure:
            {
                [msgid in ICU format]: [msgstr in ICU format],
                .
                .
                .
            }
        returns the parsed JSON object.
    */
    poStringToICUSync: function (domain, poString) {
        gt.addTextdomain(domain, poString);
        var poDomain = gt.domains[domain];
        var language = poDomain.headers.language;
        var options = {};
        if (language && domain != language) {
            throw new Error('domain specified does not match language specified in po file.');
        }

        var icuObject = {};
        var self = this;
        Object.keys(poDomain['translations']['']).forEach(function (key) {
            var msg = poDomain['translations'][''][key];
            if (msg.msgid.length > 0) {
                var icuMsg = null;
                options.poFormat = msg.comments.flag;
                if (msg.msgid_plural !== undefined) {
                    icuMsg = self.pluralMsgToICU(msg, domain, options);
                } else {
                    icuMsg = self.msgToICU(msg, options);
                }
                icuObject[icuMsg['icuId']] = icuMsg['icuStr'];
            }
        });
        return icuObject;
    },

    /*
        Parses a string representation of a po file into a JSON object asynchronously.
        The JSON object has the following structure:
            {
                [msgid in ICU format]: [msgstr in ICU format],
                .
                .
                .
            }
        Callback takes two arguments – error and the json object
    */
    poStringToICUAsync: function (domain, poString, callback) {
        var icuObject = this.poStringToICUSync(domain, poString);
        callback(null, icuObject);
    },

    /*
        Reads in a file to a string, and parses it into an icu-formatted
        JSON object.
    */
    poFileToICUAsync: function (domain, path, callback) {
        var pofile = fs.readFileSync(path, 'utf8');
        var icuObject = this.poStringToICUSync(domain, pofile);
        callback(null, icuObject);
    },

    /*
        Reads in a file to a string, and parses it into an icu-formatted
        JSON object.
    */
    poFileToICUSync: function (domain, path) {
        var pofile = fs.readFileSync(path, 'utf8');
        return this.poStringToICUSync(domain, pofile);
    }
};
