"""
Code preprocessing utilities for IPython magic commands.
"""


def preprocess_ipython_magics(code: str) -> str:
    """
    Transform IPython magic commands into valid Python code.
    
    Supports:
    - !command  -> subprocess shell execution
    - %pip install pkg -> subprocess pip
    - %cd path -> os.chdir
    - Other % magics are commented out with a warning
    """
    lines = code.split('\n')
    result = []
    
    for line in lines:
        stripped = line.lstrip()
        indent = line[:len(line) - len(stripped)]
        
        if stripped.startswith('!'):
            # Shell command: !ls -> subprocess.run("ls", shell=True)
            cmd = stripped[1:]
            result.append(f'{indent}import subprocess; subprocess.run({repr(cmd)}, shell=True)')
        
        elif stripped.startswith('%%'):
            # Cell magic - not supported
            result.append(f'{indent}# Cell magic not supported: {stripped}')
        
        elif stripped.startswith('%pip ') or stripped.startswith('%pip\t'):
            # %pip install package
            args = stripped[5:].strip()
            result.append(f'{indent}import subprocess; subprocess.run(["pip", {", ".join(repr(a) for a in args.split())}])')
        
        elif stripped.startswith('%conda '):
            # %conda install package
            args = stripped[7:].strip()
            result.append(f'{indent}import subprocess; subprocess.run(["conda", {", ".join(repr(a) for a in args.split())}])')
        
        elif stripped.startswith('%cd '):
            # %cd /path/to/dir
            path = stripped[4:].strip()
            result.append(f'{indent}import os; os.chdir({repr(path)})')
        
        elif stripped.startswith('%env '):
            # %env VAR=value or %env VAR
            env_expr = stripped[5:].strip()
            if '=' in env_expr:
                key, val = env_expr.split('=', 1)
                result.append(f'{indent}import os; os.environ[{repr(key.strip())}] = {repr(val.strip())}')
            else:
                result.append(f'{indent}import os; print(os.environ.get({repr(env_expr)}, ""))')
        
        elif stripped.startswith('%'):
            # Other line magics - not supported
            result.append(f'{indent}# Line magic not supported: {stripped}')
        
        else:
            result.append(line)
    
    return '\n'.join(result)
