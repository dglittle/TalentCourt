TalentCourt
===========

a game to discover who's the most talented

commands to set it up on heroku:

```
heroku apps:create talentcourt
heroku addons:add mongohq:sandbox

heroku config:set HOST=http://talentcourt.herokuapp.com
heroku config:set SESSION_SECRET=change_me

heroku config:set AWS_ID=change_me
heroku config:set AWS_SECRET=change_me
heroku config:set S3_BUCKET=change_me

git push heroku master
```
