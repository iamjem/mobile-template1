var http           = require('http'),
    config         = require('./server/config'),
    express        = require('express'),
    bodyParser     = require('body-parser'),
    methodOverride = require('method-override'),
    passport       = require('passport')
    path           = require('path'),
    knex           = require('knex')(config.knex_options),
    bookshelf      = require('bookshelf')(knex),
    models         = require('./server/models')(bookshelf),
    notifier       = require('./server/notifier'),
    restful        = require('./server/bookshelf_rest'),
    auth           = require('./server/auth')(models)
    ;

/********************* APP SETUP *****************************/

app = express();
server  = http.createServer(app);
io = require('socket.io')(server);

app.set('bookshelf', bookshelf);

logger = {
  debug: config.debug,
  warn: config.warn,
  error: config.error
};


app.use(bodyParser());
app.use(methodOverride());
app.use(express.static(path.join(__dirname, 'client/')));
app.use(express.static(path.join(__dirname, 'admin/')));
app.use(express.static(path.join(__dirname, 'server/pages')));

// Logging
app.use(function(req, res, next){
  logger.debug('%s %s', req.method, req.url);
  next();
});

app.use(function(err, req, res, next) {
    logger.error(err.stack);
    res.status(500).send(err.message);
});


/********************* ROUTES *****************************/

app.use('/register', auth.register);

app.all('/resource/*', auth.authenticate);

app.use('/resource', restful(models.Question, 'questions'));
app.use('/resource', restful(models.Answer, 'answers', {pre_save: save_answer}));
app.post('/resource/questions/:questionId/activate', models.activate_question);
app.post('/resource/questions/:questionId/next', models.next_question);
app.get('/resource/leaders', models.leaders);
app.delete('/resource/leaders', auth.clear_leaders);

function save_answer(req, res, callback) {
  var answer = req.body;


  answer.user_id = req.user.id;

  new models.Question({id: answer.question_id}).fetch().then(function(q) {
    if (q.attributes.answer_index == answer.answer_index) {

      io.emit('_every_answer', JSON.stringify({user: req.user, correct: true}));

      models.Answer.query({select:'*'}).where({question_id: answer.question_id})
        .fetchAll().then(function(collection) {
        if (collection.length > 0) {
          // soneone already answered this question
          req.user.incrPoints(2);
          res.send('OK');

        } else {
          callback(answer); 
          req.user.incrPoints(5);
          // Tell everyone the question is answered
          var theAnswer = '';
          try {
            theAnswer = q.attributes.answers[q.attributes.answer_index-1];
          } catch (e) {}
          io.emit('answer', JSON.stringify({user: req.user, question_id: answer.question_id,
                                            answer: theAnswer}));
        }
      });
    } else {
      io.emit('_every_answer', JSON.stringify({user: req.user, correct: false}));
      res.send(500, 'Incorrect');
      console.log("ERROR!! ", answer);
    }
  });
}

/********************* NOTIFICATIONS *****************************/


notifier(bookshelf,
  {
    'questions': function(question_id) {
      new models.Question({id:question_id})
      .fetch()
      .then(function(question) {
        question = question.attributes;
        question.answer_index = null;
        console.log("Loaded question ", question);
        if (question.show) {
          console.log("Sending next question: ", question);
          io.emit('questions', JSON.stringify(question));
        }
      });
    }
  }
)

/********************* SERVER STARTT *****************************/


app.set('port', process.env.PORT || 5000);

server.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + app.get('port'));
});

io.on('connection', function(socket){
  console.log('a user connected');
});


