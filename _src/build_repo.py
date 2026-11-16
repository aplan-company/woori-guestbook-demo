import os
here=os.path.dirname(os.path.abspath(__file__)); root=os.path.dirname(here)
R=open(os.path.join(here,'relay.js')).read()
for f in ['mobile.html','console.html','game.html']:
    s=open(os.path.join(here,f)).read().replace('/*RELAY*/', R)
    open(os.path.join(root,f),'w').write(s)
print('built')
