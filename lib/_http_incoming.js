// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var util = require('util');
var Stream = require('stream');

function readStart(socket) {
  if (!socket || !socket._handle || !socket._handle.readStart) return;
  socket._handle.readStart();
}
exports.readStart = readStart;

function readStop(socket) {
  if (!socket || !socket._handle || !socket._handle.readStop) return;
  socket._handle.readStop();
}
exports.readStop = readStop;


/* Abstract base class for ServerRequest and ClientResponse. */
function IncomingMessage(socket) {
  Stream.Readable.call(this);

  // XXX This implementation is kind of all over the place
  // When the parser emits body chunks, they go in this list.
  // _read() pulls them out, and when it finds EOF, it ends.

  this.socket = socket;
  this.connection = socket;

  this.httpVersion = null;
  this.complete = false;
  this.headers = {};
  this.trailers = {};

  this.readable = true;

  this._pendings = [];
  this._pendingIndex = 0;

  // request (server) only
  this.url = '';
  this.method = null;

  // response (client) only
  this.statusCode = null;
  this.client = this.socket;

  // flag for backwards compatibility grossness.
  this._consuming = false;

  // flag for when we decide that this message cannot possibly be
  // read by the user, so there's no point continuing to handle it.
  this._dumped = false;
}
util.inherits(IncomingMessage, Stream.Readable);


exports.IncomingMessage = IncomingMessage;


IncomingMessage.prototype.setTimeout = function(msecs, callback) {
  if (callback)
    this.on('timeout', callback);
  this.socket.setTimeout(msecs);
};


IncomingMessage.prototype.read = function(n) {
  this._consuming = true;
  this.read = Stream.Readable.prototype.read;
  return this.read(n);
};


IncomingMessage.prototype._read = function(n) {
  // We actually do almost nothing here, because the parserOnBody
  // function fills up our internal buffer directly.  However, we
  // do need to unpause the underlying socket so that it flows.
  if (!this.socket.readable)
    this.push(null);
  else
    readStart(this.socket);
};


IncomingMessage.prototype.destroy = function(error) {
  this.socket.destroy(error);
};


// Add the given (field, value) pair to the message
//
// Per RFC2616, section 4.2 it is acceptable to join multiple instances of the
// same header with a ', ' if the header in question supports specification of
// multiple values this way. If not, we declare the first instance the winner
// and drop the second. Extended header fields (those beginning with 'x-') are
// always joined.
IncomingMessage.prototype._addHeaderLine = function(field, value) {
  var dest = this.complete ? this.trailers : this.headers;

  field = field.toLowerCase();
  switch (field) {
    // Array headers:
    case 'set-cookie':
      if (dest[field] !== undefined) {
        dest[field].push(value);
      } else {
        dest[field] = [value];
      }
      break;

    // Comma separate. Maybe make these arrays?
    case 'accept':
    case 'accept-charset':
    case 'accept-encoding':
    case 'accept-language':
    case 'connection':
    case 'cookie':
    case 'pragma':
    case 'link':
    case 'www-authenticate':
    case 'proxy-authenticate':
    case 'sec-websocket-extensions':
    case 'sec-websocket-protocol':
      if (dest[field] !== undefined) {
        dest[field] += ', ' + value;
      } else {
        dest[field] = value;
      }
      break;


    default:
      if (field.slice(0, 2) == 'x-') {
        // except for x-
        if (dest[field] !== undefined) {
          dest[field] += ', ' + value;
        } else {
          dest[field] = value;
        }
      } else {
        // drop duplicates
        if (dest[field] === undefined) dest[field] = value;
      }
      break;
  }
};


// Call this instead of resume() if we want to just
// dump all the data to /dev/null
IncomingMessage.prototype._dump = function() {
  if (!this._dumped) {
    this._dumped = true;
    if (this.socket.parser) this.socket.parser.incoming = null;
    this.push(null);
    readStart(this.socket);
    this.read();
  }
};
