import re,sys
def res(p,fn):
    s=open(p).read(); s=re.sub(r'<<<<<<< ours\n(.*?)=======\n(.*?)>>>>>>> theirs\n',lambda m:fn(m.group(1),m.group(2)),s,flags=re.S); open(p,'w').write(s)
def score(l):
    st=l.rstrip().rstrip('|').split('|')[-1].lower()+' '+l.lower()
    return 0 if ('| missing' in l.lower() or l.rstrip().endswith('missing |')) else (1 if 'partial' in l.rstrip().rstrip('|').split('|')[-1].lower() else 2)
def sweep(o,t):
    out=[]; tl=t.splitlines(); ol=o.splitlines()
    tk={x.split('|')[1].strip():x for x in tl if x.startswith('|')}
    seen=set()
    for x in ol:
        k=x.split('|')[1].strip() if x.startswith('|') else x
        y=tk.get(k); seen.add(k)
        out.append(y if y and score(y)>score(x) else x)
    for x in tl:
        k=x.split('|')[1].strip() if x.startswith('|') else x
        if k not in seen: out.append(x)
    return '\n'.join(out)+'\n'
